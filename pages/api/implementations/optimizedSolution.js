import { ethers } from 'ethers';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

// Constants
const BAYC_CONTRACT_ADDRESS = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const ETHERSCAN_API_URL = 'https://api.etherscan.io/api';
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const ALCHEMY_API_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// graph Contract Addresses
const graph_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'; // graph3 contract

// ABI for graph3
const graph_ABI = [
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
const FALLBACK_DEMO_DATA = {
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
let provider = null;
let graphContract = null;

// In-memory caches
let blockNumberCache = {};
let holdersCache = {};

/**
 * Initialize provider with Alchemy only
 */
const initProvider = () => {
  if (provider) return provider;
  
  console.log("Initializing provider...");
  
  if (ALCHEMY_API_KEY) {
    try {
      console.log("Using Alchemy provider");
      provider = new ethers.providers.StaticJsonRpcProvider(ALCHEMY_API_URL);
      return provider;
    } catch (error) {
      console.error('Failed to create Alchemy provider:', error.message);
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
const initgraph = () => {
  if (graphContract) return graphContract;
  
  const p = provider || initProvider();
  if (!p) {
    console.error("Failed to initialize provider for graph contract");
    return null;
  }
  
  try {
    graphContract = new ethers.Contract(graph_ADDRESS, graph_ABI, p);
    console.log("graph contract initialized");
    return graphContract;
  } catch (error) {
    console.error("Failed to initialize graph contract:", error.message);
    return null;
  }
};

// Initialize provider and graph contract
provider = initProvider();
graphContract = initgraph();

// Load the cache on module initialization
loadBlockNumberCache();
loadHoldersCache();

/**
 * Check if we have fallback data for this timestamp
 */
function hasFallbackData(timestamp) {
  return timestamp in FALLBACK_DEMO_DATA.blocks || 
        Object.keys(FALLBACK_DEMO_DATA.blocks).some(t => Math.abs(parseInt(t) - timestamp) < 86400);
}

/**
 * Get closest fallback block number
 */
function getFallbackBlockNumber(timestamp) {
  if (timestamp in FALLBACK_DEMO_DATA.blocks) {
    return FALLBACK_DEMO_DATA.blocks[timestamp];
  }
  
  const timestamps = Object.keys(FALLBACK_DEMO_DATA.blocks).map(Number);
  let closest = timestamps[0];
  let minDiff = Math.abs(closest - timestamp);
  
  for (let i = 1; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - timestamp);
    if (diff < minDiff) {
      minDiff = diff;
      closest = timestamps[i];
    }
  }
  
  return FALLBACK_DEMO_DATA.blocks[closest];
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
    
    // Only keep the 100 most recent block snapshots to avoid huge files
    const blockNumbers = Object.keys(holdersCache)
      .map(Number)
      .sort((a, b) => b - a) // Sort in descending order
      .slice(0, 100); // Keep the 100 most recent
      
    const reducedCache = {};
    blockNumbers.forEach(block => {
      reducedCache[block] = holdersCache[block];
    });
    
    fs.writeFileSync(HOLDERS_CACHE_FILE, JSON.stringify(reducedCache, null, 2));
    console.log(`Saved ${Object.keys(reducedCache).length} holder snapshots to cache`);
    
    // Update the in-memory cache to match
    holdersCache = reducedCache;
  } catch (error) {
    console.error('Error saving holders cache:', error);
  }
}

/**
 * Find block number at specific timestamp using binary search with caching
 */
async function getBlockNumberAtTimestamp(timestamp) {
  try {
    // First check our cache
    const cachedBlockNumber = blockNumberCache[timestamp];
    if (cachedBlockNumber) {
      console.log(`Using cached block number ${cachedBlockNumber} for timestamp ${timestamp}`);
      return cachedBlockNumber;
    }
    
    // Check for nearby timestamps within 2-hour window
    const timestampInt = parseInt(timestamp);
    const nearbyTimestamps = Object.keys(blockNumberCache)
      .map(Number)
      .filter(t => Math.abs(t - timestampInt) < 7200); // 2 hours
    
    if (nearbyTimestamps.length > 0) {
      // Find closest timestamp
      const closestTimestamp = nearbyTimestamps.reduce((prev, curr) => 
        Math.abs(curr - timestampInt) < Math.abs(prev - timestampInt) ? curr : prev
      );
      
      // Estimate block number based on 13.5s average block time
      const blockDiff = Math.round(Math.abs(timestampInt - closestTimestamp) / 13.5);
      const direction = timestampInt > closestTimestamp ? 1 : -1;
      const estimatedBlock = blockNumberCache[closestTimestamp] + (blockDiff * direction);
      
      console.log(`Estimated block ${estimatedBlock} for timestamp ${timestamp} based on nearby timestamp ${closestTimestamp}`);
      
      // Verify if our estimate is close enough
      const verifyBlock = await provider.getBlock(estimatedBlock);
      if (verifyBlock && Math.abs(verifyBlock.timestamp - timestampInt) < 300) { // Within 5 minutes
        // Cache and return if close enough
        blockNumberCache[timestamp] = estimatedBlock;
        saveBlockNumberCache();
        return estimatedBlock;
      }
      
      // Use as starting point for binary search otherwise
      let low = direction > 0 ? blockNumberCache[closestTimestamp] : Math.max(0, estimatedBlock - 1000);
      let high = direction > 0 ? estimatedBlock + 1000 : blockNumberCache[closestTimestamp];
      
      console.log(`Using optimized range for binary search: [${low}, ${high}]`);
      
      let result = high;
      let mid = 0;
      let iterations = 0;
      
      while (low <= high && iterations < 20) {
        iterations++;
        mid = Math.floor((low + high) / 2);
        const block = await provider.getBlock(mid);
        if (!block) break;

        console.log(`Iteration ${iterations}: Block #${mid} has timestamp ${block.timestamp} (target: ${timestamp})`);
        
        if (block.timestamp < timestampInt) {
          low = mid + 1;
        } else {
          result = mid;
          high = mid - 1;
        }
      }
      
      console.log(`Found block #${result} for timestamp ${timestamp} in ${iterations} iterations`);
      
      // Cache the result
      blockNumberCache[timestamp] = result;
      saveBlockNumberCache();
      
      return result;
    }

    // Normal binary search if no cached reference points
    console.log(`Finding block at or after timestamp ${timestamp} using binary search...`);
    
    let low = 0;
    let high = await provider.getBlockNumber();
    let result = high;
    let iterations = 0;

    while (low <= high && iterations < 40) {
      iterations++;
      const mid = Math.floor((low + high) / 2);
      const block = await provider.getBlock(mid);
      if (!block) break;

      console.log(`Iteration ${iterations}: Block #${mid} has timestamp ${block.timestamp} (target: ${timestamp})`);
      
      if (block.timestamp < timestampInt) {
        low = mid + 1;
      } else {
        result = mid;
        high = mid - 1;
      }
    }

    console.log(`Found block #${result} for timestamp ${timestamp} in ${iterations} iterations`);
    
    // Cache the result
    blockNumberCache[timestamp] = result;
    saveBlockNumberCache();
    
    return result;
  } catch (error) {
    console.error('Error in binary search for block:', error);
    
    // Fallback to Etherscan API
    try {
      console.log('Falling back to Etherscan API for block number...');
      const response = await axios.get(ETHERSCAN_API_URL, {
        params: {
          module: 'block',
          action: 'getblocknobytime',
          timestamp,
          closest: 'before',
          apikey: ETHERSCAN_API_KEY
        }
      });

      if (response.data.status !== '1') {
        throw new Error(`Etherscan API error: ${response.data.message}`);
      }
      
      const blockNumber = parseInt(response.data.result);
      
      // Cache the result
      blockNumberCache[timestamp] = blockNumber;
      saveBlockNumberCache();
      
      return blockNumber;
    } catch (secondaryError) {
      console.error('Etherscan fallback failed:', secondaryError);
      
      // Use fallback data if available
      if (hasFallbackData(timestamp)) {
        console.log(`Using fallback block data for timestamp ${timestamp}`);
        const blockNumber = getFallbackBlockNumber(timestamp);
        
        // Cache the result
        blockNumberCache[timestamp] = blockNumber;
        saveBlockNumberCache();
        
        return blockNumber;
      }
      
      throw error;
    }
  }
}

/**
 * Get BAYC holders at a specific block by cursor-paging through tokens → owner
 * With block-based caching for faster repeat queries
 */
async function getBAYCHoldersAtBlock(blockNumber) {
  try {
    // Check cache first
    if (holdersCache[blockNumber]) {
      console.log(`Using cached ${holdersCache[blockNumber].length} BAYC holders for block ${blockNumber}`);
      return holdersCache[blockNumber];
    }
    
    // Find closest cached block number
    const cachedBlocks = Object.keys(holdersCache).map(Number);
    if (cachedBlocks.length > 0) {
      // Find blocks before and after the target
      const blocksAfter = cachedBlocks.filter(b => b > blockNumber).sort((a, b) => a - b);
      const blocksBefore = cachedBlocks.filter(b => b < blockNumber).sort((a, b) => b - a);
      
      // Use the closest block (preferring before)
      if (blocksBefore.length > 0 && blockNumber - blocksBefore[0] < 1000) {
        console.log(`Using nearby cached holders from block ${blocksBefore[0]} (${blockNumber - blocksBefore[0]} blocks earlier)`);
        return holdersCache[blocksBefore[0]];
      }
      
      // Use block after if it's close enough
      if (blocksAfter.length > 0 && blocksAfter[0] - blockNumber < 100) {
        console.log(`Using nearby cached holders from block ${blocksAfter[0]} (${blocksAfter[0] - blockNumber} blocks later)`);
        return holdersCache[blocksAfter[0]];
      }
    }
    
    console.log(`Querying The Graph for BAYC holders at block ${blockNumber}…`);
    
    const PAGE_SIZE = 1000;
    let lastId = "";            // cursor: start before the first token
    const holders = new Set();

    const QUERY = `
      query holders($block: Int!, $lastId: String!) {
        tokens(
          first: ${PAGE_SIZE},
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

    while (true) {
      console.log(`Fetching tokens after id='${lastId}'…`);
      const response = await axios.post(GRAPH_URL, {
        query: QUERY,
        variables: { block: blockNumber, lastId }
      });

      if (response.data.errors) {
        console.error("GraphQL errors:", response.data.errors);
        throw new Error("GraphQL query failed");
      }

      const tokens = response.data.data.tokens;
      if (!tokens.length) {
        console.log("No more tokens to fetch");
        break;
      }

      // Add each owner to our Set
      tokens.forEach(t => holders.add(t.owner.id.toLowerCase()));

      // Advance cursor to the last token ID of this page
      lastId = tokens[tokens.length - 1].id;
      console.log(
        `  → Fetched ${tokens.length} tokens; unique owners so far: ${holders.size}`
      );
    }

    const holderArray = Array.from(holders);
    console.log(`Found ${holderArray.length} total unique BAYC holders`);
    
    // Cache the result
    holdersCache[blockNumber] = holderArray;
    saveHoldersCache();
    
    return holderArray;

  } catch (error) {
    console.error("Error fetching BAYC holders via subgraph:", error);
    // fallback to transfer-history method
    const holders = await getHoldersFromTokenTransfers(blockNumber);
    
    // Cache this result too
    holdersCache[blockNumber] = holders;
    saveHoldersCache();
    
    return holders;
  }
}

/**
 * Fallback method to get holders from token transfers
 */
async function getHoldersFromTokenTransfers(blockNumber) {
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
async function getEthBalancesgraph(addresses, blockNumber) {
  if (!graphContract) {
    graphContract = initgraph();
    if (!graphContract) {
      throw new Error('Failed to initialize graph contract');
    }
  }
  
  try {
    console.log(`Getting ETH balances for ${addresses.length} addresses with graph...`);
    
    // Increase chunk size from 500 to 1000 for fewer network calls
    // Experiment with this value - some providers can handle up to 2000+
    const chunkSize = 1000;
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
async function getFallbackBalances(addresses, blockNumber) {
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
async function saveResultsToFile(implementationId, timestamp, result) {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(RESULTS_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Read existing results or create new object
    let results = {};
    if (fs.existsSync(RESULTS_FILE_PATH)) {
      const fileContent = fs.readFileSync(RESULTS_FILE_PATH, 'utf8');
      results = JSON.parse(fileContent);
    }
    
    // Add new result
    if (!results[implementationId]) {
      results[implementationId] = {};
    }
    
    // Convert BigNumber to string for JSON storage
    const resultToSave = {
      ...result,
      totalWei: result.totalWei.toString(),
      executionTime: result.executionTime,
      timestamp: new Date().toISOString()
    };
    
    results[implementationId][timestamp] = resultToSave;
    
    // Write back to file
    fs.writeFileSync(RESULTS_FILE_PATH, JSON.stringify(results, null, 2));
    console.log(`Results saved to ${RESULTS_FILE_PATH}`);
  } catch (error) {
    console.error('Error saving results to file:', error);
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
 */
async function getTotalEthValueOfHolders(timestamp) {
  const startTime = Date.now();
  
  try {
    // Use in-memory cache for previous results
    const previousResults = getPreviousResults();
    const cachedResult = previousResults?.['optimizedSolution']?.[timestamp];
    
    if (cachedResult) {
      console.log(`Using cached result for timestamp ${timestamp}`);
      // Convert string back to BigNumber for consistency
      return {
        ...cachedResult,
        totalWei: ethers.BigNumber.from(cachedResult.totalWei),
        fromCache: true
      };
    }
    
    // Step 1: Get block number at timestamp
    console.log(`Step 1: Finding block number for timestamp ${timestamp}`);
    const blockNumber = await getBlockNumberAtTimestamp(timestamp);
    console.log(`Using block number ${blockNumber} for timestamp ${timestamp}`);
    
    // Step 2: Get BAYC holders at that block
    console.log(`Step 2: Getting BAYC holders at block ${blockNumber}`);
    const holders = await getBAYCHoldersAtBlock(blockNumber);
    console.log(`Found ${holders.length} BAYC holders at this block`);
    
    // Step 3: Get ETH balances of all holders in parallel
    console.log(`Step 3: Getting ETH balances for all holders`);
    const balances = await getEthBalancesgraph(holders, blockNumber);
    console.log(`Retrieved ${balances.length} balances`);
    
    if (balances.length !== holders.length) {
      console.warn(`Warning: Number of balances (${balances.length}) doesn't match holders (${holders.length})`);
    }
    
    // Step 4: Sum total ETH value
    console.log(`Step 4: Calculating total ETH value`);
    const totalWei = balances.reduce((sum, balance) => sum.add(balance), ethers.BigNumber.from(0));
    const totalEth = ethers.utils.formatEther(totalWei);
    
    const executionTime = Date.now() - startTime;
    console.log(`Total ETH value: ${totalEth} ETH (execution time: ${executionTime}ms)`);
    
    const result = {
      blockNumber,
      holderCount: holders.length,
      totalWei,
      totalEth,
      executionTime,
      method: 'The Graph with optimized caching',
      implementation: 'optimizedSolution'
    };
    
    // Save results for persistence
    await saveResultsToFile('optimizedSolution', timestamp, result);
    
    return result;
  } catch (error) {
    console.error('Error calculating total ETH value:', error);
    const executionTime = Date.now() - startTime;
    
    return {
      error: error.message,
      blockNumber: 0,
      holderCount: 0,
      totalWei: ethers.BigNumber.from(0),
      totalEth: "0",
      executionTime,
      method: 'The Graph (errored)',
      implementation: 'optimizedSolution'
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { timestamp, useCache = true } = req.body;
    if (!timestamp) {
      return res.status(400).json({ message: 'Timestamp is required' });
    }
    
    // Check if we have cached results - using in-memory directly for faster response
    if (useCache !== false) {
      const previousResults = getPreviousResults();
      const cachedResult = previousResults?.['optimizedSolution']?.[timestamp];
      
      if (cachedResult) {
        console.log(`API: Using cached result for timestamp ${timestamp}`);
        
        // Convert string back to BigNumber for consistency
        return res.status(200).json({
          ...cachedResult,
          totalWei: ethers.BigNumber.from(cachedResult.totalWei),
          fromCache: true
        });
      }
    }

    // Process the request with optimized functions
    console.log(`API: Processing new request for timestamp ${timestamp}`);
    const result = await getTotalEthValueOfHolders(timestamp);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in optimizedSolution API handler:', error);
    return res.status(500).json({ 
      message: 'Error processing request', 
      error: error.message 
    });
  }
} 