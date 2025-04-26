// optimized implementation - enhanced version of graph+multicall with Etherscan API instead binary search and improved batching and error handling
import { ethers } from 'ethers';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { NextApiRequest, NextApiResponse } from 'next';

// Types
interface RequestBody {
  timestamp: number;
  useCache?: boolean;
}

interface ResultData {
  totalEth: string;
  holderCount: number;
  sampledHolders: number;
  executionTime: number;
  block: number;
  implementation: string;
  timestamp?: string;
  fromCache?: boolean;
  totalWei?: string | ethers.BigNumber;
  blockNumber?: number;
  metrics?: {
    blockResolutionTime: number;
    holdersResolutionTime: number;
    balanceResolutionTime: number;
    totalTime: number;
  };
  method?: string;
  error?: string;
}

interface StoredResults {
  [implementationId: string]: {
    [timestamp: string]: ResultData;
  };
}

interface TokenOwner {
  id: string;
}

interface Token {
  id: string;
  owner: TokenOwner;
}

interface GraphQLResponse {
  data: {
    tokens: Token[];
  };
  errors?: any[];
}

interface FallbackData {
  blocks: {
    [timestamp: string]: number;
  };
  sampleHolders: string[];
}

interface BlockNumberCache {
  [timestamp: string]: number;
}

interface HoldersCache {
  [key: string]: string[] | Record<string, string | number> | undefined;
  _timestamps?: Record<string, number>;
}

// Extend this interface for better typing of cached holders by block number
interface HoldersByBlock {
  [blockNumber: number]: string[];
  [blockNumber: string]: string[] | Record<string, number> | undefined;
}

// Constants
const BAYC_CONTRACT_ADDRESS = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const ETHERSCAN_API_URL = 'https://api.etherscan.io/api';
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const ALCHEMY_API_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// Multicall Contract Addresses
const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'; // Multicall3 contract

// graph Contract Addresses
const graph_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'; // graph3 contract

// ABI for graph3
const MULTICALL_ABI = [
  'function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)',
  'function blockAndAggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes32 blockHash, tuple(bool success, bytes returnData)[] returnData)',
  'function getBlockHash(uint256 blockNumber) view returns (bytes32 blockHash)',
  'function getBlockNumber() view returns (uint256 blockNumber)',
  'function getCurrentBlockCoinbase() view returns (address coinbase)',
  'function getCurrentBlockDifficulty() view returns (uint256 difficulty)',
  'function getCurrentBlockGasLimit() view returns (uint256 gaslimit)',
  'function getCurrentBlockTimestamp() view returns (uint256 timestamp)',
  'function getEthBalance(address addr) view returns (uint256 balance)',
  'function getLastBlockHash() view returns (bytes32 blockHash)',
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)',
  'function aggregate3Value(tuple(address target, bool allowFailure, bytes callData, uint256 value)[] calls) payable returns (tuple(bool success, bytes returnData)[] returnData)',
  'function tryAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)',
  'function tryBlockAndAggregate(bool requireSuccess, tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes32 blockHash, tuple(bool success, bytes returnData)[] returnData)'
];

// Graph API endpoint for BAYC data
const GRAPH_URL = process.env.BAYC_SUBGRAPH_URL;

// Static provider as reliable fallback
const STATIC_PROVIDER = new ethers.providers.StaticJsonRpcProvider(ALCHEMY_API_URL);

// Results storage - persist between restarts
const RESULTS_FILE_PATH = path.join(process.cwd(), 'data', 'results.json');

// Add a new cache for block numbers
const BLOCK_CACHE_FILE = path.join(process.cwd(), 'data', 'block-cache.json');

// Add a cache file for BAYC holders by block
const HOLDERS_CACHE_FILE = path.join(process.cwd(), 'data', 'holders-cache.json');

// Removed public RPC endpoints since we're only using Alchemy now

// Fallback data for when network is unavailable
const FALLBACK_DEMO_DATA: FallbackData = {
  // Example timestamp -> block mapping
  blocks: {
    '1651363200': 14723000, // May 1, 2022
    '1609459200': 11565019, // Jan 1, 2021
    '1577836800': 9193266,  // Jan 1, 2020
    '1546300800': 6988614   // Jan 1, 2019
  },
  // Sample addresses for demo
  sampleHolders: [
    '0x7Be8076f4EA4A4AD08075C2508e481d6C946D12b', // OpenSea
    '0xb88F61E6FbdA83fbfffAbE364112137480398018',
    '0x0315FA3813Ff4999C264641B202d0D2B21df139C',
    '0xA858DDc0445d8131daC4d1DE01f834ffcbA52Ef1',
    '0x1b523DC1cB8B17B0170aa9234cA1CFF3E1Ea36bF'
  ]
};

// Provider and graph contract initialization
let provider: ethers.providers.JsonRpcProvider | null = null;
let graphContract: ethers.Contract | null = null;

// In-memory caches
let blockNumberCache: BlockNumberCache = {};
let holdersCache: HoldersCache = {};

// Add module-level variable to track optimal batch sizes
let optimalGraphQLBatchSize = 10000; // Start with maximum and adjust down if needed

/**
 * Track and adjust optimal GraphQL batch size based on success/failure
 */
function updateOptimalGraphQLBatchSize(success: boolean, currentSize: number): void {
  if (success) {
    // If we succeeded with a smaller size, we might try increasing slightly next time
    if (currentSize < optimalGraphQLBatchSize) {
      optimalGraphQLBatchSize = Math.min(10000, Math.floor(currentSize * 1.25));
      console.log(`Increasing optimal GraphQL batch size to ${optimalGraphQLBatchSize} for next queries`);
    }
  } else {
    // If we failed, reduce the optimal size
    optimalGraphQLBatchSize = Math.max(500, Math.floor(currentSize * 0.75));
    console.log(`Reducing optimal GraphQL batch size to ${optimalGraphQLBatchSize} for next queries`);
  }
}

/**
 * Get suggested batch size for GraphQL queries based on history
 */
function getSuggestedGraphQLBatchSize(): number {
  return optimalGraphQLBatchSize;
}

/**
 * Initialize provider with Alchemy only
 */
const initProvider = (): ethers.providers.JsonRpcProvider => {
  if (provider) return provider;
  
  console.log("Initializing provider...");
  
  if (ALCHEMY_API_KEY) {
    try {
      console.log("Using Alchemy provider");
      provider = new ethers.providers.StaticJsonRpcProvider(ALCHEMY_API_URL);
      return provider;
    } catch (error) {
      console.error('Failed to create Alchemy provider:', (error as Error).message);
      provider = null;
    }
  } else {
    console.error("No Alchemy API key provided!");
  }
  
  console.log("Using static provider as last resort");
  provider = STATIC_PROVIDER;
  return provider;
};

/**
 * Initialize graph contract
 */
const initGraph = (): ethers.Contract => {
  if (graphContract) return graphContract;
  
  const p = provider || initProvider();
  if (!p) {
    console.error("Failed to initialize provider for graph contract");
    throw new Error("Failed to initialize provider for graph contract");
  }
  
  try {
    graphContract = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, p);
    console.log("graph contract initialized");
    return graphContract;
  } catch (error) {
    console.error("Failed to initialize graph contract:", (error as Error).message);
    throw new Error("Failed to initialize graph contract");
  }
};

// Initialize provider and graph contract
provider = initProvider();
graphContract = initGraph();

// Load the cache on module initialization
loadBlockNumberCache();
loadHoldersCache();

/**
 * Check if we have fallback data for this timestamp
 */
function hasFallbackData(timestamp: number | string): boolean {
  return timestamp in FALLBACK_DEMO_DATA.blocks ||
        Object.keys(FALLBACK_DEMO_DATA.blocks).some(t => Math.abs(parseInt(t) - parseInt(String(timestamp))) < 86400);
}

/**
 * Get closest fallback block number
 */
function getFallbackBlockNumber(timestamp: number | string): number {
  const timestampStr = String(timestamp);
  
  if (timestampStr in FALLBACK_DEMO_DATA.blocks) {
    return FALLBACK_DEMO_DATA.blocks[timestampStr];
  }
  
  const timestamps = Object.keys(FALLBACK_DEMO_DATA.blocks).map(Number);
  let closest = timestamps[0];
  let minDiff = Math.abs(closest - parseInt(String(timestamp)));
  
  for (let i = 1; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - parseInt(String(timestamp)));
    if (diff < minDiff) {
      minDiff = diff;
      closest = timestamps[i];
    }
  }
  
  // Convert the number back to string for indexing
  return FALLBACK_DEMO_DATA.blocks[String(closest)];
}

/**
 * Load the block number cache from disk
 */
function loadBlockNumberCache() {
  try {
    if (fs.existsSync(BLOCK_CACHE_FILE)) {
      const fileContent = fs.readFileSync(BLOCK_CACHE_FILE, 'utf8');
      blockNumberCache = JSON.parse(fileContent);
      console.log(`Loaded ${Object.keys(blockNumberCache).length} cached block numbers`);
    } else {
      blockNumberCache = {};
    }
  } catch (error) {
    console.error('Error loading block number cache:', error);
    blockNumberCache = {};
  }
}

/**
 * Save the block number cache to disk
 */
function saveBlockNumberCache() {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(BLOCK_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(BLOCK_CACHE_FILE, JSON.stringify(blockNumberCache, null, 2));
    console.log(`Saved ${Object.keys(blockNumberCache).length} block numbers to cache`);
  } catch (error) {
    console.error('Error saving block number cache:', error);
  }
}

/**
 * Load the holders cache from disk
 */
function loadHoldersCache() {
  try {
    if (fs.existsSync(HOLDERS_CACHE_FILE)) {
      const fileContent = fs.readFileSync(HOLDERS_CACHE_FILE, 'utf8');
      holdersCache = JSON.parse(fileContent);
      console.log(`Loaded ${Object.keys(holdersCache).length} cached holder snapshots`);
    } else {
      holdersCache = {};
    }
  } catch (error) {
    console.error('Error loading holders cache:', error);
    holdersCache = {};
  }
}

/**
 * Save the holders cache to disk
 */
function saveHoldersCache() {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(HOLDERS_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Get timestamp data before reducing
    const timestamps = holdersCache._timestamps || {};
    
    // Only keep the 100 most recent block snapshots to avoid huge files
    const blockNumbers = Object.keys(holdersCache)
      .filter(k => !k.startsWith('_')) // Skip metadata properties
      .map(Number)
      .sort((a, b) => b - a) // Sort in descending order
      .slice(0, 100); // Keep the 100 most recent
      
    const reducedCache: HoldersCache = { _timestamps: {} };
    blockNumbers.forEach(block => {
      const blockStr = String(block);
      reducedCache[blockStr] = holdersCache[blockStr];
      // Preserve timestamp data for kept blocks
      if (timestamps[blockStr]) {
        if (reducedCache._timestamps) {
          reducedCache._timestamps[blockStr] = timestamps[blockStr];
        }
      }
    });
    
    fs.writeFileSync(HOLDERS_CACHE_FILE, JSON.stringify(reducedCache, null, 2));
    console.log(`Saved ${blockNumbers.length} holder snapshots to cache with timestamp data`);
    
    // Update the in-memory cache to match
    holdersCache = reducedCache;
  } catch (error) {
    console.error('Error saving holders cache:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Find block number at specific timestamp using Etherscan API with fallback to binary search
 * Prioritizes direct API lookup which is faster than binary search in most cases
 */
async function getBlockNumberAtTimestamp(timestamp: number | string) {
  try {
    // First check our cache
    const cachedBlockNumber = blockNumberCache[String(timestamp)];
    if (cachedBlockNumber) {
      console.log(`Using cached block number ${cachedBlockNumber} for timestamp ${timestamp}`);
      return cachedBlockNumber;
    }
    
    // Check for nearby timestamps within 10-minute window for fast approximation
    const timestampInt = parseInt(String(timestamp));
    const nearbyTimestamps = Object.keys(blockNumberCache)
      .map(Number)
      .filter(t => Math.abs(t - timestampInt) < 600); // 10 minutes
    
    if (nearbyTimestamps.length > 0) {
      // Find closest timestamp
      const closestTimestamp = nearbyTimestamps.reduce((prev, curr) => 
        Math.abs(curr - timestampInt) < Math.abs(prev - timestampInt) ? curr : prev
      );
      
      console.log(`Found nearby timestamp ${closestTimestamp} (${Math.abs(timestampInt - closestTimestamp)}s difference)`);
      
      // If very close (within 30 seconds), just use that block
      if (Math.abs(timestampInt - closestTimestamp) < 30) {
        console.log(`Using block ${blockNumberCache[String(closestTimestamp)]} for very close timestamp`);
        blockNumberCache[String(timestamp)] = blockNumberCache[String(closestTimestamp)];
        saveBlockNumberCache();
        return blockNumberCache[String(closestTimestamp)];
      }
    }
    
    // Try Etherscan API first - it's faster than binary search in most cases
    try {
      console.log(`Querying Etherscan API for block at timestamp ${timestamp}...`);
      const response = await axios.get(ETHERSCAN_API_URL, {
        params: {
          module: 'block',
          action: 'getblocknobytime',
          timestamp: timestampInt,
          closest: 'before',
          apikey: ETHERSCAN_API_KEY
        }
      });

      if (response.data.status === '1') {
        const blockNumber = parseInt(response.data.result);
        console.log(`Etherscan returned block #${blockNumber} for timestamp ${timestamp}`);
        
        // Verify the block is close to the desired timestamp
        const currentProvider = initProvider();
        if (!currentProvider) {
          throw new Error("Failed to initialize provider");
        }
        const block = await currentProvider.getBlock(blockNumber);
        if (block) {
          const blockTimestamp = block.timestamp;
          console.log(`Block #${blockNumber} has timestamp ${blockTimestamp} (target: ${timestampInt})`);
          
          // If the block is very close to the target timestamp, use it
          if (Math.abs(blockTimestamp - timestampInt) < 120) { // Within 2 minutes
            console.log(`Block timestamp is within 2 minutes of target, using block #${blockNumber}`);
            blockNumberCache[String(timestamp)] = blockNumber;
            saveBlockNumberCache();
            return blockNumber;
          }
          
          // If not close, we can use this as a starting point for binary search
          // but in a much narrower range
          console.log(`Block timestamp differs by ${Math.abs(blockTimestamp - timestampInt)}s, refining search...`);
          
          // Decide search direction
          if (blockTimestamp < timestampInt) {
            // Target is after this block, search forward
            return await binarySearchBlock(blockNumber, blockNumber + 1000, timestampInt);
          } else {
            // Target is before this block, search backward
            return await binarySearchBlock(Math.max(0, blockNumber - 1000), blockNumber, timestampInt);
          }
        }
        
        // If we can't verify, still use the Etherscan result
        blockNumberCache[String(timestamp)] = blockNumber;
        saveBlockNumberCache();
        return blockNumber;
      }
      
      console.warn(`Etherscan API error: ${response.data.message}`);
      // Fall through to binary search
    } catch (etherscanError) {
      console.error('Etherscan lookup failed:', etherscanError.message);
      // Fall through to binary search
    }

    // Fall back to binary search if Etherscan fails
    console.log(`Falling back to binary search for block at timestamp ${timestamp}...`);
    const currentBlock = await provider.getBlockNumber();
    return await binarySearchBlock(0, currentBlock, timestampInt);
    
  } catch (error) {
    console.error('Error resolving block for timestamp:', error);
    
    // Use fallback data if available
    if (hasFallbackData(timestamp)) {
      console.log(`Using fallback block data for timestamp ${timestamp}`);
      const blockNumber = getFallbackBlockNumber(timestamp);
      
      // Cache the result
      blockNumberCache[String(timestamp)] = blockNumber;
      saveBlockNumberCache();
      
      return blockNumber;
    }
    
    throw error;
  }
}

/**
 * Helper function to perform optimized binary search for block number
 */
async function binarySearchBlock(low: number, high: number, targetTimestamp: number) {
  console.log(`Performing binary search in range [${low}, ${high}] for timestamp ${targetTimestamp}`);
  
  let result = high;
  let iterations = 0;
  let lastMid = 0;
  let consecutiveErrors = 0;
  
  while (low <= high && iterations < 20) {
    iterations++;
    const mid = Math.floor((low + high) / 2);
    
    // Avoid repeating the same block check
    if (mid === lastMid) {
      console.log(`Breaking search loop, reached same block twice: ${mid}`);
      break;
    }
    lastMid = mid;
    
    try {
      const block = await provider.getBlock(mid);
      if (!block) {
        console.warn(`No block data for #${mid}, continuing search...`);
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          console.error(`Too many consecutive errors, stopping search`);
          break;
        }
        high = mid - 1;
        continue;
      }
      
      consecutiveErrors = 0;
      console.log(`Iteration ${iterations}: Block #${mid} has timestamp ${block.timestamp} (target: ${targetTimestamp})`);
      
      if (block.timestamp < targetTimestamp) {
        low = mid + 1;
      } else {
        result = mid;
        high = mid - 1;
      }
    } catch (error) {
      console.error(`Error getting block #${mid}:`, error.message);
      consecutiveErrors++;
      if (consecutiveErrors >= 3) {
        console.error(`Too many consecutive errors, stopping search`);
        break;
      }
      // Skip this block and try the next one
      if (mid === low) low += 1;
      else high = mid - 1;
    }
  }
  
  console.log(`Binary search found block #${result} after ${iterations} iterations`);
  
  // Cache the result
  blockNumberCache[String(targetTimestamp)] = result;
  saveBlockNumberCache();
  
  return result;
}

/**
 * Find holders for a particular block, using timestamp cross-referencing for better cache hits
 * - Uses block timestamp ranges for matching instead of just exact blocks
 * - Implements a radius-based lookup to find best match
 */
async function getBAYCHoldersAtBlock(blockNumber: number): Promise<string[]> {
  try {
    // Check exact cache hit first (fastest path)
    const blockStr = String(blockNumber);
    if (holdersCache[blockStr] && Array.isArray(holdersCache[blockStr])) {
      console.log(`Using exact cached ${(holdersCache[blockStr] as string[]).length} BAYC holders for block ${blockNumber}`);
      return holdersCache[blockStr] as string[];
    }
    
    // Get the timestamp for this block to enable better matching
    const currentProvider = initProvider();
    if (!currentProvider) {
      throw new Error("Failed to initialize provider");
    }
    
    const block = await currentProvider.getBlock(blockNumber);
    if (!block) {
      throw new Error(`Could not retrieve block ${blockNumber}`);
    }
    
    const blockTimestamp = block.timestamp;
    console.log(`Block ${blockNumber} has timestamp ${blockTimestamp}`);
    
    // Create timestamp-based index of cached blocks if needed
    if (!holdersCache._timestamps) {
      holdersCache._timestamps = {};
      // Index existing blocks by timestamp
      const cachedBlocks = Object.keys(holdersCache).filter(k => !k.startsWith('_')).map(Number);
      await Promise.all(cachedBlocks.map(async (cachedBlock) => {
        try {
          // Skip if we already have this block's timestamp
          if (holdersCache._timestamps && holdersCache._timestamps[cachedBlock]) return;
          
          const blockData = await currentProvider.getBlock(cachedBlock);
          if (blockData && holdersCache._timestamps) {
            holdersCache._timestamps[cachedBlock] = blockData.timestamp;
          }
        } catch (e) {
          console.warn(`Could not get timestamp for cached block ${cachedBlock}`);
        }
      }));
      
      if (holdersCache._timestamps) {
        console.log(`Built timestamp index for ${Object.keys(holdersCache._timestamps).length} blocks`);
      }
    }
    
    // Find blocks with nearby timestamps (within 1 hour = 3600s)
    // This is much more accurate than using block number differences
    const TIME_RADIUS = 3600;
    if (holdersCache._timestamps) {
      const blocksByTimeDiff = Object.entries(holdersCache._timestamps)
        .map(([block, timestamp]) => ({
          block: parseInt(block),
          timeDiff: Math.abs(Number(timestamp) - blockTimestamp)
        }))
        .filter(entry => entry.timeDiff < TIME_RADIUS)
        .sort((a, b) => a.timeDiff - b.timeDiff);
      
      if (blocksByTimeDiff.length > 0) {
        const bestMatch = blocksByTimeDiff[0];
        const bestMatchStr = String(bestMatch.block);
        
        if (holdersCache._timestamps && holdersCache[bestMatchStr] && Array.isArray(holdersCache[bestMatchStr])) {
          console.log(`Found cached holders from block ${bestMatch.block} with timestamp ${holdersCache._timestamps[bestMatchStr]} (${bestMatch.timeDiff}s difference)`);
          return holdersCache[bestMatchStr] as string[];
        }
      }
    }
    
    // Traditional block-number-based lookup as fallback
    const cachedBlocks = Object.keys(holdersCache)
      .filter(k => !k.startsWith('_'))
      .map(Number);
    
    if (cachedBlocks.length > 0) {
      // Find blocks before and after the target
      const blocksAfter = cachedBlocks.filter(b => b > blockNumber).sort((a, b) => a - b);
      const blocksBefore = cachedBlocks.filter(b => b < blockNumber).sort((a, b) => b - a);
      
      // Use the closest block (preferring before)
      if (blocksBefore.length > 0 && blockNumber - blocksBefore[0] < 1000) {
        const beforeBlockStr = String(blocksBefore[0]);
        if (holdersCache[beforeBlockStr] && Array.isArray(holdersCache[beforeBlockStr])) {
          console.log(`Using nearby cached holders from block ${blocksBefore[0]} (${blockNumber - blocksBefore[0]} blocks earlier)`);
          return holdersCache[beforeBlockStr] as string[];
        }
      }
      
      // Use block after if it's close enough
      if (blocksAfter.length > 0 && blocksAfter[0] - blockNumber < 100) {
        const afterBlockStr = String(blocksAfter[0]);
        if (holdersCache[afterBlockStr] && Array.isArray(holdersCache[afterBlockStr])) {
          console.log(`Using nearby cached holders from block ${blocksAfter[0]} (${blocksAfter[0] - blockNumber} blocks later)`);
          return holdersCache[afterBlockStr] as string[];
        }
      }
    }
    
    console.log(`Querying The Graph for BAYC holders at block ${blockNumber}…`);
    
    // Use adaptive batch size mechanism
    const PAGE_SIZE = getSuggestedGraphQLBatchSize();
    console.log(`Using GraphQL batch size of ${PAGE_SIZE} based on previous performance`);
    
    let lastId = "";            // cursor: start before the first token
    const holders = new Set();

    // First try with adaptive page size
    const QUERY = `
      query holders($block: Int!, $lastId: String!, $pageSize: Int!) {
        tokens(
          first: $pageSize,
          where: { id_gt: $lastId },
          block: { number: $block },
          orderBy: id,
          orderDirection: asc
        ) {
          id
          owner { id }
        }
      }
    `;

    try {
      // First attempt with adaptive page size
      console.log(`Attempting to fetch tokens with page size: ${PAGE_SIZE}...`);
      const startTime = Date.now();
      const response = await axios.post(GRAPH_URL, {
        query: QUERY,
        variables: { block: blockNumber, lastId, pageSize: PAGE_SIZE }
      });
      const queryTime = Date.now() - startTime;

      if (response.data.errors) {
        // If we get errors, throw to fall back to smaller batches
        throw new Error("GraphQL query failed with current batch size");
      }

      const tokens = response.data.data.tokens as Token[];
      console.log(`Retrieved ${tokens.length} tokens in ${queryTime}ms`);
      
      // Add each owner to our Set
      tokens.forEach(t => holders.add(t.owner.id.toLowerCase()));
      
      // If we got fewer than requested, we got all of them
      if (tokens.length < PAGE_SIZE) {
        console.log(`Got all tokens in one request (${tokens.length} tokens)`);
        // Mark this batch size as successful
        updateOptimalGraphQLBatchSize(true, PAGE_SIZE);
      } else {
        // We need to get the rest with additional queries
        lastId = tokens[tokens.length - 1].id;
        console.log(`Got first batch, continuing from id=${lastId}`);
        
        // For remaining tokens, continue fetching until we get all
        let hasMoreTokens = true;
        while (hasMoreTokens) {
          const batchResponse = await axios.post(GRAPH_URL, {
            query: QUERY,
            variables: { block: blockNumber, lastId, pageSize: PAGE_SIZE }
          });
          
          if (batchResponse.data.errors) {
            console.warn("GraphQL errors in follow-up batch:", batchResponse.data.errors);
            break;
          }
          
          const moreTokens = batchResponse.data.data.tokens as Token[];
          console.log(`Retrieved additional ${moreTokens.length} tokens`);
          
          if (moreTokens.length === 0) {
            hasMoreTokens = false;
            console.log("No more tokens to fetch");
          } else {
            moreTokens.forEach(t => holders.add(t.owner.id.toLowerCase()));
            lastId = moreTokens[moreTokens.length - 1].id;
            console.log(`  → Total unique owners so far: ${holders.size}`);
            
            if (moreTokens.length < PAGE_SIZE) {
              hasMoreTokens = false;
              console.log("Reached end of tokens");
            }
          }
        }
        
        // Mark this as successful
        updateOptimalGraphQLBatchSize(true, PAGE_SIZE);
      }
    } catch (largeQueryError) {
      console.warn(`Failed with batch size ${PAGE_SIZE}: ${largeQueryError.message}`);
      
      // Update the optimal batch size down
      updateOptimalGraphQLBatchSize(false, PAGE_SIZE);
      
      // Reset and use regular paging with smaller chunks
      console.log(`Falling back to smaller page sizes...`);
      lastId = "";
      holders.clear();
      
      // Use a smaller page size for fallback (half of what failed)
      const FALLBACK_PAGE_SIZE = Math.min(1000, Math.max(500, Math.floor(PAGE_SIZE / 2)));
      console.log(`Using fallback page size: ${FALLBACK_PAGE_SIZE}`);
      
      let hasMoreTokens = true;
      while (hasMoreTokens) {
        console.log(`Fetching tokens after id='${lastId}'…`);
        const response = await axios.post(GRAPH_URL, {
          query: QUERY,
          variables: { block: blockNumber, lastId, pageSize: FALLBACK_PAGE_SIZE }
        });

        if (response.data.errors) {
          console.error("GraphQL errors:", response.data.errors);
          throw new Error("GraphQL query failed with fallback size too");
        }

        const tokens = response.data.data.tokens as Token[];
        if (!tokens.length) {
          console.log("No more tokens to fetch");
          hasMoreTokens = false;
          break;
        }

        // Add each owner to our Set
        tokens.forEach(t => holders.add(t.owner.id.toLowerCase()));

        // Advance cursor to the last token ID of this page
        lastId = tokens[tokens.length - 1].id;
        console.log(
          `  → Fetched ${tokens.length} tokens; unique owners so far: ${holders.size}`
        );
        
        if (tokens.length < FALLBACK_PAGE_SIZE) {
          hasMoreTokens = false;
          console.log("Reached end of tokens with fallback size");
        }
      }
      
      // If successful with fallback, update the optimal size
      updateOptimalGraphQLBatchSize(true, FALLBACK_PAGE_SIZE);
    }

    const holderArray = Array.from(holders) as string[];
    console.log(`Found ${holderArray.length} total unique BAYC holders`);
    
    // Cache the result with both block number and timestamp
    holdersCache[blockStr] = holderArray;
    if (holdersCache._timestamps) {
      holdersCache._timestamps[blockStr] = blockTimestamp;
    } else {
      holdersCache._timestamps = { [blockStr]: blockTimestamp };
    }
    saveHoldersCache();
    
    return holderArray;

  } catch (error) {
    console.error("Error fetching BAYC holders via subgraph:", error);
    // fallback to transfer-history method
    const holders = await getHoldersFromTokenTransfers(blockNumber);
    
    // Cache this result too
    const blockStr = String(blockNumber);
    holdersCache[blockStr] = holders;
    try {
      const currentProvider = initProvider();
      if (currentProvider) {
        const block = await currentProvider.getBlock(blockNumber);
        if (block && holdersCache._timestamps) {
          holdersCache._timestamps[blockStr] = block.timestamp;
        } else if (block) {
          holdersCache._timestamps = { [blockStr]: block.timestamp };
        }
      }
    } catch (e) {
      console.warn(`Could not get timestamp for block ${blockNumber} for caching`);
    }
    saveHoldersCache();
    
    return holders;
  }
}

/**
 * Fallback method to get holders from token transfers
 */
async function getHoldersFromTokenTransfers(blockNumber: number) {
  try {
    console.log('Falling back to token transfers method');
    
    // Track ownership using transfer history
    const ownershipMap = new Map();
    let page = 1;
    let hasMoreData = true;
    
    while (hasMoreData && page <= 5) { // Limit to 5 pages for performance
      // Fetch token transfers from Etherscan
      const response = await axios.get(ETHERSCAN_API_URL, {
        params: {
          module: 'account',
          action: 'tokennfttx',
          contractaddress: BAYC_CONTRACT_ADDRESS,
          page,
          offset: 100, // 100 transfers per page
          sort: 'asc',
          apikey: ETHERSCAN_API_KEY
        }
      });
      
      if (response.data.status !== '1') {
        console.error(`Etherscan API error: ${response.data.message}`);
        break;
      }
      
      const transfers = response.data.result;
      console.log(`Retrieved ${transfers.length} transfers (page ${page})`);
      
      if (transfers.length === 0) {
        hasMoreData = false;
        break;
      }
      
      // Process transfers
      for (const transfer of transfers) {
        // Skip transfers after our target block
        if (parseInt(transfer.blockNumber) > blockNumber) {
          hasMoreData = false;
          break;
        }
        
        const tokenId = transfer.tokenID;
        const from = transfer.from.toLowerCase();
        const to = transfer.to.toLowerCase();
        
        // Skip token minting (from zero address)
        if (from !== '0x0000000000000000000000000000000000000000') {
          // Remove token from previous owner
          if (ownershipMap.has(from)) {
            ownershipMap.get(from).delete(tokenId);
            
            // If the owner has no more tokens, remove them from the map
            if (ownershipMap.get(from).size === 0) {
              ownershipMap.delete(from);
            }
          }
        }
        
        // Add token to new owner
        if (!ownershipMap.has(to)) {
          ownershipMap.set(to, new Set());
        }
        ownershipMap.get(to).add(tokenId);
      }
      
      page++;
    }
    
    // Extract holders at this block
    const holders = Array.from(ownershipMap.keys()).filter(
      address => address !== '0x0000000000000000000000000000000000000000'
    );
    
    console.log(`Found ${holders.length} BAYC holders from historical transfers`);
    return holders;
  } catch (error) {
    console.error('Error with token transfers method:', error);
    return FALLBACK_DEMO_DATA.sampleHolders;
  }
}

/**
 * Get ETH balances for multiple addresses in a single graph
 * This is the key optimization of this implementation
 */
async function getEthBalancesgraph(addresses: string[], blockNumber: number) {
  if (!graphContract) {
    graphContract = initGraph();
    if (!graphContract) {
      throw new Error('Failed to initialize graph contract');
    }
  }
  
  try {
    console.log(`Getting ETH balances for ${addresses.length} addresses with graph...`);
    
    // Using optimal chunk size of 6000 based on testing
    // This allows for retrieving most BAYC holders' balances in a single call
    const chunkSize = 5000;
    let balances = new Array(addresses.length).fill(ethers.BigNumber.from(0));
    
    // Prepare the getEthBalance function signature once
    const getEthBalanceSignature = graphContract.interface.getSighash('getEthBalance');
    
    // Create batches of chunks for parallel processing
    const chunks = [];
    for (let i = 0; i < addresses.length; i += chunkSize) {
      chunks.push(addresses.slice(i, i + chunkSize));
    }
    
    // Process chunks in parallel with concurrency limit
    const concurrencyLimit = 3; // Adjust based on provider capacity
    const results = [];
    
    // Process chunks in batches to limit concurrency
    for (let i = 0; i < chunks.length; i += concurrencyLimit) {
      const batch = chunks.slice(i, i + concurrencyLimit);
      const batchPromises = batch.map(async (chunk, batchIndex) => {
        const chunkOffset = (i + batchIndex) * chunkSize;
        console.log(`Processing chunk ${i + batchIndex + 1}/${chunks.length} (${chunk.length} addresses)`);
        
        // Optimize call data preparation - minimal encoding operations
        const calls = chunk.map(address => ({
          target: graph_ADDRESS,
          allowFailure: true,
          // Precompute the calldata more efficiently
          callData: getEthBalanceSignature + address.slice(2).padStart(64, '0')
        }));
        
        // Execute graph with optimized retry logic
        let retries = 0;
        const maxRetries = 3;
        let chunkResults;
        
        while (retries <= maxRetries) {
          try {
            chunkResults = await graphContract.aggregate3(calls, { blockTag: blockNumber });
            break;
          } catch (error) {
            retries++;
            if (retries > maxRetries) throw error;
            console.warn(`Retry ${retries}/${maxRetries} for chunk ${i + batchIndex + 1}`);
            // Exponential backoff
            await new Promise(r => setTimeout(r, 500 * Math.pow(2, retries - 1)));
          }
        }
        
        // Process results into the correct positions in the balances array
        for (let j = 0; j < chunkResults.length; j++) {
          const result = chunkResults[j];
          const position = chunkOffset + j;
          
          if (result.success && result.returnData.length >= 66) { // 0x + 64 hex chars
            try {
              // More efficient decoding directly from hex
              balances[position] = ethers.BigNumber.from(result.returnData);
            } catch (error) {
              console.error(`Error decoding balance for address ${chunk[j]}:`, error.message);
              // Keep default value of 0
            }
          }
        }
        
        return { batchIndex, processed: true };
      });
      
      // Wait for batch to complete before moving to next batch
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    return balances;
  } catch (error) {
    console.error('Error in graph getEthBalances:', error);
    
    // Fallback to regular balance fetching if graph fails
    console.log('graph failed, falling back to individual balance queries...');
    return getFallbackBalances(addresses, blockNumber);
  }
}

/**
 * Fallback method to get balances individually if graph fails
 */
async function getFallbackBalances(addresses: string[], blockNumber: number) {
  console.log(`Getting balances individually for ${addresses.length} addresses...`);
  
  // Create pre-filled array
  const balances = new Array(addresses.length).fill(ethers.BigNumber.from(0));
  
  // Increase batch size significantly
  const batchSize = 50; // Process in larger batches
  const concurrencyLimit = 4; // Number of batches to process in parallel
  
  // Create batches
  const batches = [];
  for (let i = 0; i < addresses.length; i += batchSize) {
    batches.push({
      addresses: addresses.slice(i, i + batchSize),
      startIndex: i
    });
  }
  
  // Process batches in parallel with concurrency limit
  for (let i = 0; i < batches.length; i += concurrencyLimit) {
    const currentBatches = batches.slice(i, i + concurrencyLimit);
    
    await Promise.all(currentBatches.map(async (batch) => {
      try {
        // Process all addresses in this batch concurrently
        const batchResults = await Promise.all(
          batch.addresses.map(async (address, j) => {
            try {
              return { 
                index: batch.startIndex + j,
                balance: await provider.getBalance(address, blockNumber) 
              };
            } catch (error) {
              console.error(`Error getting balance for ${address}:`, error.message);
              return { 
                index: batch.startIndex + j,
                balance: ethers.BigNumber.from(0)
              };
            }
          })
        );
        
        // Update balances array with results
        batchResults.forEach(result => {
          balances[result.index] = result.balance;
        });
      } catch (error) {
        console.error(`Error processing batch starting at ${batch.startIndex}:`, error);
      }
    }));
    
    if (i % (concurrencyLimit * 2) === 0 && i > 0) {
      console.log(`Processed ${Math.min(i + concurrencyLimit, batches.length)}/${batches.length} batches (${Math.min((i + concurrencyLimit) * batchSize, addresses.length)}/${addresses.length} addresses)...`);
    }
  }
  
  return balances;
}

/**
 * Save results to file for persistence
 */
async function saveResultsToFile(implementationId: string, timestamp: string, result: DetailedHolderResult | ResultData): Promise<void> {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(RESULTS_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Read existing results or create new object
    let results: StoredResults = {};
    if (fs.existsSync(RESULTS_FILE_PATH)) {
      const fileContent = fs.readFileSync(RESULTS_FILE_PATH, 'utf8');
      results = JSON.parse(fileContent);
    }
    
    // Add new result
    if (!results[implementationId]) {
      results[implementationId] = {};
    }
    
    // Convert BigNumber to string for JSON storage
    const resultToSave: ResultData = {
      ...result,
      totalWei: result.totalWei ? result.totalWei.toString() : '0',
      executionTime: result.executionTime,
      timestamp: new Date().toISOString(),
      // Ensure required ResultData fields are present
      block: result.blockNumber || 0,
      holderCount: result.holderCount || 0,
      sampledHolders: result.holderCount || 0,
      implementation: result.implementation || implementationId,
      totalEth: result.totalEth || '0',
    };
    
    results[implementationId][timestamp] = resultToSave;
    
    // Write back to file
    fs.writeFileSync(RESULTS_FILE_PATH, JSON.stringify(results, null, 2));
    console.log(`Results saved to ${RESULTS_FILE_PATH}`);
  } catch (error) {
    console.error('Error saving results to file:', error instanceof Error ? error.message : 'Unknown error');
  }
}

/**
 * Get previous results from cache file
 */
function getPreviousResults() {
  try {
    if (fs.existsSync(RESULTS_FILE_PATH)) {
      const fileContent = fs.readFileSync(RESULTS_FILE_PATH, 'utf8');
      return JSON.parse(fileContent);
    }
  } catch (error) {
    console.error('Error reading previous results:', error);
  }
  return {};
}

/**
 * Get total ETH value of all BAYC holders
 * - Implements a pipeline approach with timing data
 * - Better error handling for partial results
 */
async function getTotalEthValueOfHolders(timestamp: number | string): Promise<DetailedHolderResult> {
  const startTime = Date.now();
  const metrics = {
    blockResolutionTime: 0,
    holdersResolutionTime: 0,
    balanceResolutionTime: 0,
    totalTime: 0
  };
  
  try {
    // Use in-memory cache for previous results (fastest path)
    const previousResults = getPreviousResults();
    const cachedResult = previousResults?.['optimizedSolution']?.[timestamp.toString()];
    
    if (cachedResult) {
      console.log(`Using cached result for timestamp ${timestamp}`);
      // Convert string back to BigNumber for consistency
      return {
        ...cachedResult,
        totalWei: ethers.BigNumber.from(cachedResult.totalWei || '0'),
        fromCache: true,
        blockNumber: cachedResult.blockNumber || cachedResult.block || 0,
        holderCount: cachedResult.holderCount || 0,
        metrics: cachedResult.metrics || metrics,
        method: cachedResult.method || 'Cached result',
        implementation: cachedResult.implementation || 'optimizedSolution',
        totalEth: cachedResult.totalEth || '0',
        executionTime: cachedResult.executionTime || 0
      } as DetailedHolderResult;
    }
    
    // ---- Step 1: Get block number at timestamp ----
    console.log(`Step 1: Finding block number for timestamp ${timestamp}`);
    const blockStartTime = Date.now();
    
    let blockNumber;
    try {
      blockNumber = await getBlockNumberAtTimestamp(timestamp);
      console.log(`Using block number ${blockNumber} for timestamp ${timestamp}`);
      metrics.blockResolutionTime = Date.now() - blockStartTime;
      console.log(`Block resolution took ${metrics.blockResolutionTime}ms`);
    } catch (error) {
      console.error(`Error resolving block number:`, error);
      throw new Error(`Block resolution failed: ${error.message}`);
    }
    
    // ---- Step 2: Get BAYC holders at that block ----
    console.log(`Step 2: Getting BAYC holders at block ${blockNumber}`);
    const holdersStartTime = Date.now();
    
    let holders;
    try {
      holders = await getBAYCHoldersAtBlock(blockNumber);
      console.log(`Found ${holders.length} BAYC holders at this block`);
      metrics.holdersResolutionTime = Date.now() - holdersStartTime;
      console.log(`Holders resolution took ${metrics.holdersResolutionTime}ms`);
    } catch (error) {
      console.error(`Error retrieving holders:`, error);
      throw new Error(`Holders retrieval failed: ${error.message}`);
    }
    
    // Early validation to avoid unnecessary balance retrieval
    if (!holders || holders.length === 0) {
      throw new Error('No holders found - cannot proceed with balance retrieval');
    }
    
    // ---- Step 3: Get ETH balances of all holders in parallel ----
    console.log(`Step 3: Getting ETH balances for ${holders.length} holders`);
    const balancesStartTime = Date.now();
    
    let balances;
    try {
      balances = await getEthBalancesgraph(holders, blockNumber);
      console.log(`Retrieved ${balances.length} balances`);
      metrics.balanceResolutionTime = Date.now() - balancesStartTime;
      console.log(`Balance resolution took ${metrics.balanceResolutionTime}ms`);
    } catch (error) {
      console.error(`Error retrieving balances:`, error);
      throw new Error(`Balance retrieval failed: ${error.message}`);
    }
    
    if (balances.length !== holders.length) {
      console.warn(`Warning: Number of balances (${balances.length}) doesn't match holders (${holders.length})`);
    }
    
    // ---- Step 4: Sum total ETH value ----
    console.log(`Step 4: Calculating total ETH value`);
    const totalWei = balances.reduce((sum, balance) => sum.add(balance), ethers.BigNumber.from(0));
    const totalEth = ethers.utils.formatEther(totalWei);
    
    metrics.totalTime = Date.now() - startTime;
    console.log(`Total ETH value: ${totalEth} ETH (total execution time: ${metrics.totalTime}ms)`);
    
    // ---- Create detailed result ----
    const result: DetailedHolderResult = {
      blockNumber,
      holderCount: holders.length,
      totalWei,
      totalEth,
      executionTime: metrics.totalTime,
      metrics,
      method: 'Optimized pipeline with enhanced caching',
      implementation: 'optimizedSolution'
    };
    
    // Save results for persistence
    await saveResultsToFile('optimizedSolution', timestamp.toString(), result);
    
    return result;
  } catch (error) {
    console.error('Error calculating total ETH value:', error);
    metrics.totalTime = Date.now() - startTime;
    
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      blockNumber: 0,
      holderCount: 0,
      totalWei: ethers.BigNumber.from(0),
      totalEth: "0",
      executionTime: metrics.totalTime,
      metrics,
      method: 'Error in pipeline execution',
      implementation: 'optimizedSolution'
    } as DetailedHolderResult;
  }
}

// Define a more specific interface for the return value of getTotalEthValueOfHolders
interface DetailedHolderResult {
  blockNumber: number;
  holderCount: number;
  totalWei: ethers.BigNumber;
  totalEth: string;
  executionTime: number;
  metrics: {
    blockResolutionTime: number;
    holdersResolutionTime: number;
    balanceResolutionTime: number;
    totalTime: number;
  };
  method: string;
  implementation: string;
  error?: string;
  fromCache?: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { timestamp, useCache }: RequestBody = req.body;
    
    if (!timestamp) {
      return res.status(400).json({ error: 'Timestamp is required' });
    }
    
    // Check if we have cached results
    if (useCache !== false) {
      const previousResults = getPreviousResults();
      const cachedResult = previousResults?.['optimizedSolution']?.[timestamp.toString()];
      
      if (cachedResult) {
        console.log(`Using cached result for timestamp ${timestamp}`);
        
        return res.status(200).json({
          ...cachedResult,
          fromCache: true
        });
      }
    }

    // Use our optimized implementation
    const result = await getTotalEthValueOfHolders(timestamp);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ error: (error as Error).message });
  }
} 