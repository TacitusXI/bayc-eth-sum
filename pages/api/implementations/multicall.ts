// multicall implementation - uses multicall for ALL RPC queries
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
  totalWei?: ethers.BigNumber;
  executionTime: number;
  block: number;
  implementation: string;
  timestamp?: string;
  fromCache?: boolean;
}

interface StoredResults {
  [implementationId: string]: {
    [timestamp: string]: ResultData;
  };
}

interface MulticallResult {
  success: boolean;
  returnData: string;
}

// Constants
const BAYC_CONTRACT_ADDRESS = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const ETHERSCAN_API_URL = 'https://api.etherscan.io/api';
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const ALCHEMY_API_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// Multicall Contract Addresses
const MULTICALL_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'; // Multicall3 contract

// ABI for Multicall3
const MULTICALL_ABI = [
  'function aggregate(tuple(address target, bytes callData)[] calls) view returns (uint256 blockNumber, bytes[] returnData)',
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[] returnData)',
  'function getEthBalance(address addr) view returns (uint256 balance)'
];

// ABI for ERC721 (BAYC)
const BAYC_ABI = [
  'function totalSupply() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)'
];

// Results file path
const RESULTS_FILE_PATH = path.join(process.cwd(), 'data', 'results.json');

// Provider and contract initialization
let provider: ethers.providers.JsonRpcProvider | null = null;
let multicallContract: ethers.Contract | null = null;

/**
 * Initialize provider
 */
const initProvider = (): ethers.providers.JsonRpcProvider => {
  if (provider) return provider;
  
  console.log("Initializing provider...");
  
  if (ALCHEMY_API_KEY) {
    try {
      console.log("Using Alchemy provider");
      provider = new ethers.providers.JsonRpcProvider(ALCHEMY_API_URL);
      return provider;
    } catch (error) {
      console.error('Failed to create provider:', (error as Error).message);
      provider = null;
    }
  } else {
    console.error("No Alchemy API key provided!");
  }
  
  throw new Error("Failed to initialize provider");
};

/**
 * Initialize Multicall contract
 */
const initMulticall = (): ethers.Contract => {
  if (multicallContract) return multicallContract;
  
  const p = provider || initProvider();
  
  try {
    multicallContract = new ethers.Contract(MULTICALL_ADDRESS, MULTICALL_ABI, p);
    console.log("Multicall contract initialized");
    return multicallContract;
  } catch (error) {
    console.error("Failed to initialize multicall contract:", (error as Error).message);
    throw new Error("Failed to initialize multicall contract");
  }
};

/**
 * Save results to file for persistence
 */
async function saveResultsToFile(implementationId: string, timestamp: number, result: ResultData): Promise<void> {
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
    const resultToSave = {
      ...result,
      totalWei: undefined,
      executionTime: result.executionTime,
      timestamp: new Date().toISOString()
    };
    
    results[implementationId][timestamp.toString()] = resultToSave;
    
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
function getPreviousResults(): StoredResults {
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
 * Find block number at specific timestamp using Etherscan API
 */
async function getBlockNumberAtTimestamp(timestamp: number): Promise<number> {
  try {
    console.log(`Looking up block number for timestamp ${timestamp} using Etherscan API...`);
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
    console.log(`Found block #${blockNumber} for timestamp ${timestamp}`);
    return blockNumber;
  } catch (error) {
    console.error('Error getting block number:', error);
    throw error;
  }
}

/**
 * Get BAYC total supply using multicall
 */
async function getTotalSupply(blockNumber: number): Promise<number> {
  if (!multicallContract) {
    multicallContract = initMulticall();
  }
  
  console.log(`Getting BAYC totalSupply at block ${blockNumber} using multicall...`);
  
  const baycInterface = new ethers.utils.Interface(BAYC_ABI);
  const callData = baycInterface.encodeFunctionData('totalSupply', []);
  
  const calls = [{
    target: BAYC_CONTRACT_ADDRESS,
    callData
  }];
  
  const [, returnData] = await multicallContract.aggregate(calls, { blockTag: blockNumber });
  const totalSupply = ethers.BigNumber.from(returnData[0]).toNumber();
  
  console.log(`BAYC totalSupply: ${totalSupply}`);
  return totalSupply;
}

/**
 * Get BAYC token owners using multicall in batches
 */
async function getTokenOwners(totalSupply: number, blockNumber: number): Promise<string[]> {
  if (!multicallContract) {
    multicallContract = initMulticall();
  }
  
  console.log(`Getting owners for all ${totalSupply} tokens using multicall in batches...`);
  
  const baycInterface = new ethers.utils.Interface(BAYC_ABI);
  const owners = new Set<string>();
  const batchSize = 50; // Process in batches of 50 tokens
  
  for (let i = 1; i <= totalSupply; i += batchSize) {
    const end = Math.min(i + batchSize - 1, totalSupply);
    console.log(`Processing tokens ${i} to ${end}...`);
    
    // Create calls for this batch
    const calls = [];
    for (let tokenId = i; tokenId <= end; tokenId++) {
      calls.push({
        target: BAYC_CONTRACT_ADDRESS,
        allowFailure: true,
        callData: baycInterface.encodeFunctionData('ownerOf', [tokenId])
      });
    }
    
    // Execute multicall
    const results: MulticallResult[] = await multicallContract.aggregate3(calls, { blockTag: blockNumber });
    
    // Process results
    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.success) {
        try {
          const owner = baycInterface.decodeFunctionResult('ownerOf', result.returnData)[0].toLowerCase();
          if (owner !== '0x0000000000000000000000000000000000000000') {
            owners.add(owner);
          }
        } catch (error) {
          console.warn(`Failed to decode owner for token ${i + j}:`, (error as Error).message);
        }
      } else {
        console.warn(`Token ${i + j} ownership check failed`);
      }
    }
  }
  
  const holderArray = Array.from(owners);
  console.log(`Found ${holderArray.length} unique holders`);
  return holderArray;
}

/**
 * Get ETH balances using multicall
 */
async function getEthBalancesMulticall(addresses: string[], blockNumber: number): Promise<ethers.BigNumber> {
  if (!multicallContract) {
    multicallContract = initMulticall();
  }
  
  console.log(`Getting ETH balances for ${addresses.length} addresses using multicall in batches...`);
  
  let totalBalance = ethers.BigNumber.from(0);
  const batchSize = 100; // Process in batches to avoid gas limits
  
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, Math.min(i + batchSize, addresses.length));
    console.log(`Processing balance batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(addresses.length/batchSize)} (${batch.length} addresses)...`);
    
    // Create multicall calls for this batch
    const calls = batch.map(address => ({
      target: MULTICALL_ADDRESS,
      callData: new ethers.utils.Interface(MULTICALL_ABI).encodeFunctionData('getEthBalance', [address])
    }));
    
    try {
      // Execute multicall
      const [, returnData] = await multicallContract.aggregate(calls, { blockTag: blockNumber });
      
      // Process results
      for (const data of returnData) {
        const balance = ethers.BigNumber.from(data);
        totalBalance = totalBalance.add(balance);
      }
    } catch (error) {
      console.error(`Error processing batch ${i}-${i+batch.length}:`, (error as Error).message);
    }
  }
  
  return totalBalance;
}

/**
 * Get total ETH value of all BAYC holders at timestamp
 */
async function getTotalEthValueOfHolders(timestamp: number): Promise<{
  totalWei: ethers.BigNumber;
  holderCount: number;
  block: number;
  executionTime: number;
}> {
  console.log(`Starting multicall implementation for timestamp ${timestamp}...`);
  const startTime = Date.now();
  
  // Initialize provider and contract
  initProvider();
  initMulticall();
  
  // Get block number for timestamp
  const blockNumber = await getBlockNumberAtTimestamp(timestamp);
  console.log(`Using block #${blockNumber} for calculations`);
  
  // Get total supply of BAYC tokens
  const totalSupply = await getTotalSupply(blockNumber);
  
  // Get all token owners
  const holders = await getTokenOwners(totalSupply, blockNumber);
  console.log(`Found ${holders.length} unique BAYC holders`);
  
  // Get ETH balances for all holders
  const totalWei = await getEthBalancesMulticall(holders, blockNumber);
  console.log(`Total ETH balance: ${ethers.utils.formatEther(totalWei)} ETH`);
  
  const executionTime = Date.now() - startTime;
  console.log(`Execution completed in ${executionTime}ms`);
  
  return {
    totalWei,
    holderCount: holders.length,
    block: blockNumber,
    executionTime
  };
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
      const cachedResult = previousResults?.['multicall']?.[timestamp.toString()];
      
      if (cachedResult) {
        console.log(`Using cached result for timestamp ${timestamp}`);
        return res.status(200).json({
          ...cachedResult,
          fromCache: true
        });
      }
    }
    
    // Get data using multicall
    const { totalWei, holderCount, block, executionTime } = await getTotalEthValueOfHolders(timestamp);
    
    // Format result
    const result: ResultData = {
      totalEth: ethers.utils.formatEther(totalWei),
      holderCount,
      sampledHolders: holderCount,
      totalWei,
      executionTime,
      block,
      implementation: 'multicall'
    };
    
    // Save result to file
    await saveResultsToFile('multicall', timestamp, result);
    
    // Return result
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error processing request:', error);
    return res.status(500).json({ error: (error as Error).message });
  }
} 