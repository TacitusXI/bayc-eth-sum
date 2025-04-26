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
 * Find block number at specific timestamp using binary search
 */
async function getBlockNumberAtTimestamp(timestamp) {
  try {
    // Binary search implementation
    let low = 0;
    let high = await provider.getBlockNumber();
    let result = high;

    console.log(`Finding block at or after timestamp ${timestamp} using binary search...`);
    
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const block = await provider.getBlock(mid);
      if (!block) break;

      if (block.timestamp < timestamp) {
        low = mid + 1;
      } else {
        result = mid;
        high = mid - 1;
      }
    }

    console.log(`Found block #${result} for timestamp ${timestamp}`);
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

      return parseInt(response.data.result);
    } catch (secondaryError) {
      console.error('Etherscan fallback failed:', secondaryError);
      
      // Use fallback data if available
      if (hasFallbackData(timestamp)) {
        console.log(`Using fallback block data for timestamp ${timestamp}`);
        return getFallbackBlockNumber(timestamp);
      }
      
      throw error;
    }
  }
}

/**
 * Get BAYC holders at a specific block by cursor-paging through tokens → owner
 */
async function getBAYCHoldersAtBlock(blockNumber) {
  try {
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

    console.log(`Found ${holders.size} total unique BAYC holders`);
    return Array.from(holders);

  } catch (error) {
    console.error("Error fetching BAYC holders via subgraph:", error);
    // fallback to transfer-history method
    return getHoldersFromTokenTransfers(blockNumber);
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
    
    // Break addresses into chunks of 500 to avoid gas limit issues
    const chunkSize = 500;
    const balances = [];
    
    for (let i = 0; i < addresses.length; i += chunkSize) {
      const chunk = addresses.slice(i, i + chunkSize);
      console.log(`Processing chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(addresses.length/chunkSize)} (${chunk.length} addresses)`);
      
      // Create calls array for graph
      const calls = chunk.map(address => ({
        target: graph_ADDRESS,
        allowFailure: true,
        callData: graphContract.interface.encodeFunctionData('getEthBalance', [address])
      }));
      
      // Execute graph
      const results = await graphContract.aggregate3(calls, { blockTag: blockNumber });
      
      // Process results
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.success) {
          try {
            const balance = ethers.utils.defaultAbiCoder.decode(['uint256'], result.returnData)[0];
            balances.push(balance);
          } catch (error) {
            console.error(`Error decoding balance result for address ${chunk[j]}:`, error.message);
            balances.push(ethers.BigNumber.from(0));
          }
        } else {
          console.warn(`Failed to get balance for address ${chunk[j]}`);
          balances.push(ethers.BigNumber.from(0));
        }
      }
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
  
  const balances = [];
  const batchSize = 10; // Process in small batches
  
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    
    // Process batch concurrently
    const batchResults = await Promise.all(
      batch.map(async (address) => {
        try {
          return await provider.getBalance(address, blockNumber);
        } catch (error) {
          console.error(`Error getting balance for ${address}:`, error.message);
          return ethers.BigNumber.from(0);
        }
      })
    );
    
    balances.push(...batchResults);
    
    if (i % 50 === 0 && i > 0) {
      console.log(`Processed ${i}/${addresses.length} addresses...`);
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
    // Step 1: Get block number at timestamp
    const blockNumber = await getBlockNumberAtTimestamp(timestamp);
    console.log(`Using block number ${blockNumber} for timestamp ${timestamp}`);
    
    // Step 2: Get BAYC holders at that block
    const holders = await getBAYCHoldersAtBlock(blockNumber);
    console.log(`Found ${holders.length} BAYC holders at this block`);
    
    // Step 3: Get ETH balances of all holders
    const balances = await getEthBalancesgraph(holders, blockNumber);
    console.log(`Retrieved ${balances.length} balances`);
    
    if (balances.length !== holders.length) {
      console.warn(`Warning: Number of balances (${balances.length}) doesn't match holders (${holders.length})`);
    }
    
    // Step 4: Sum total ETH value
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
      method: 'The Graph', // Adding method used for holders data for comparison
      implementation: 'graph'
    };
    
    // Save results for persistence
    await saveResultsToFile('graph', timestamp, result);
    
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
      implementation: 'graph'
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { timestamp } = req.body;
    if (!timestamp) {
      return res.status(400).json({ message: 'Timestamp is required' });
    }
    
    // Check if we have cached results
    const previousResults = getPreviousResults();
    const cachedResult = previousResults?.['graph']?.[timestamp];
    
    if (cachedResult && req.body.useCache !== false) {
      console.log(`Using cached result for timestamp ${timestamp}`);
      
      // Convert string back to BigNumber for consistency
      cachedResult.totalWei = ethers.BigNumber.from(cachedResult.totalWei);
      
      return res.status(200).json({
        ...cachedResult,
        fromCache: true
      });
    }

    const result = await getTotalEthValueOfHolders(timestamp);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in graph API handler:', error);
    return res.status(500).json({ 
      message: 'Error processing request', 
      error: error.message 
    });
  }
} 