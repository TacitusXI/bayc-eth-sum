// basic implementation - uses individual RPC calls for each token and balance query

import { ethers } from 'ethers'
import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { NextApiRequest, NextApiResponse } from 'next'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ResultData {
  totalEth: string;
  holderCount: number;
  sampledHolders: number;
  executionTime: number;
  block: number;
  implementation: string;
  timestamp?: string;
  fromCache?: boolean;
}

interface RequestBody {
  timestamp: number;
  useCache?: boolean;
}

interface StoredResults {
  [implementationId: string]: {
    [timestamp: string]: ResultData;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants & configuration
// ─────────────────────────────────────────────────────────────────────────────

const BAYC_CONTRACT_ADDRESS   = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D'
const ETHERSCAN_API_URL       = 'https://api.etherscan.io/api'
const ETHERSCAN_API_KEY       = process.env.ETHERSCAN_API_KEY || ''
const ALCHEMY_API_KEY         = process.env.ALCHEMY_API_KEY || ''
const ALCHEMY_API_URL         = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
// Define the results file path
const RESULTS_FILE_PATH = path.join(process.cwd(), 'data', 'results.json')

// ERC-721 ABI bits we need
const BAYC_ERC721_ABI         = [
  'function totalSupply() view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)'
]

// ─────────────────────────────────────────────────────────────────────────────
// Provider & Contract Initialization
// ─────────────────────────────────────────────────────────────────────────────

let provider: ethers.providers.JsonRpcProvider | null = null
function initProvider(): ethers.providers.JsonRpcProvider {
  if (provider) return provider
  if (!ALCHEMY_API_KEY) {
    throw new Error('ALCHEMY_API_KEY is not set')
  }
  provider = new ethers.providers.JsonRpcProvider(ALCHEMY_API_URL)
  return provider
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save results to file for persistence
 */
async function saveResultsToFile(implementationId: string, timestamp: number, result: ResultData): Promise<void> {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(RESULTS_FILE_PATH)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    
    // Read existing results or create new object
    let results: StoredResults = {}
    if (fs.existsSync(RESULTS_FILE_PATH)) {
      const fileContent = fs.readFileSync(RESULTS_FILE_PATH, 'utf8')
      results = JSON.parse(fileContent)
    }
    
    // Add new result
    if (!results[implementationId]) {
      results[implementationId] = {}
    }
    
    // Convert BigNumber to string for JSON storage (if applicable)
    const resultToSave = {
      ...result,
      timestamp: new Date().toISOString()
    }
    
    results[implementationId][timestamp.toString()] = resultToSave
    
    // Write back to file
    fs.writeFileSync(RESULTS_FILE_PATH, JSON.stringify(results, null, 2))
    console.log(`Results saved to ${RESULTS_FILE_PATH}`)
  } catch (error) {
    console.error('Error saving results to file:', error)
  }
}

/**
 * Get previous results from cache file
 */
function getPreviousResults(): StoredResults {
  try {
    if (fs.existsSync(RESULTS_FILE_PATH)) {
      const fileContent = fs.readFileSync(RESULTS_FILE_PATH, 'utf8')
      return JSON.parse(fileContent)
    }
  } catch (error) {
    console.error('Error reading previous results:', error)
  }
  return {}
}

/** Look up the block number for a UNIX timestamp (seconds) via Etherscan */
async function getBlockNumberAtTimestamp(timestamp: number): Promise<number> {
  const resp = await axios.get(ETHERSCAN_API_URL, {
    params: {
      module: 'block',
      action: 'getblocknobytime',
      timestamp,
      closest: 'before',
      apikey: ETHERSCAN_API_KEY
    }
  })
  if (resp.data.status !== '1') {
    throw new Error(`Etherscan error: ${resp.data.message}`)
  }
  return parseInt(resp.data.result)
}

/**
 * Enumerate all BAYC holders by calling ownerOf(tokenId) for each ID = 1..N.
 * Performs N+1 on-chain calls at the given block.
 */
async function getBAYCHoldersDirect(blockNumber: number): Promise<string[]> {
  console.log(`☑ Getting totalSupply() at block ${blockNumber}`)
  // Create contract instance with provider
  const baycContract = new ethers.Contract(
    BAYC_CONTRACT_ADDRESS,
    BAYC_ERC721_ABI,
    initProvider()
  )
  
  const totalSupplyBN = await baycContract.totalSupply({ blockTag: blockNumber })
  const totalSupply = totalSupplyBN.toNumber()
  console.log(`☑ totalSupply = ${totalSupply}`)

  console.log(`Processing all ${totalSupply} tokens (this may take a while)`)

  const holders = new Set<string>()
  for (let tokenId = 1; tokenId <= totalSupply; tokenId++) {
    try {
      const owner = await baycContract.ownerOf(tokenId, { blockTag: blockNumber })
      holders.add(owner.toLowerCase())
    } catch (err) {
      console.warn(`⚠ ownerOf(${tokenId}) failed: ${(err as Error).message}`)
    }
    if (tokenId % 10 === 0 || tokenId === totalSupply) {
      console.log(`  → ownerOf calls: ${tokenId}/${totalSupply}`)
    }
  }
  return Array.from(holders).filter(addr => addr !== '0x0000000000000000000000000000000000000000')
}

/**
 * Get ETH balance for an address using basic RPC call
 */
async function getEthBalance(address: string, blockNumber: number): Promise<ethers.BigNumber> {
  try {
    const p = initProvider()
    const balance = await p.getBalance(address, blockNumber)
    return balance
  } catch (error) {
    console.error(`Error getting balance for ${address}:`, (error as Error).message)
    return ethers.BigNumber.from(0)
  }
}

/**
 * Get all ETH balances using individual RPC calls
 */
async function getAllBalances(addresses: string[], blockNumber: number): Promise<ethers.BigNumber> {
  console.log(`Getting balances for ${addresses.length} addresses using individual RPC calls`)
  
  let totalBalance = ethers.BigNumber.from(0)
  let processedCount = 0
  
  // Process addresses in smaller batches to show progress
  const batchSize = 10
  
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, Math.min(i + batchSize, addresses.length))
    console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(addresses.length/batchSize)} (${batch.length} addresses)`)
    
    // Get balances sequentially for this batch
    for (const address of batch) {
      const balance = await getEthBalance(address, blockNumber)
      totalBalance = totalBalance.add(balance)
      processedCount++
    }
    
    console.log(`Processed ${processedCount}/${addresses.length} addresses so far`)
  }
  
  return totalBalance
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { timestamp, useCache }: RequestBody = req.body
    
    if (!timestamp) {
      return res.status(400).json({ error: 'Timestamp is required' })
    }
    
    // Check if we have cached results
    if (useCache !== false) {
      const previousResults = getPreviousResults()
      const cachedResult = previousResults?.['basic']?.[timestamp.toString()]
      
      if (cachedResult) {
        console.log(`Using cached result for timestamp ${timestamp}`)
        
        return res.status(200).json({
          ...cachedResult,
          fromCache: true
        })
      }
    }

    const startTs = Date.now()

    // 1) Get block for timestamp
    const blockNumber = await getBlockNumberAtTimestamp(timestamp)
    console.log(`🚀 Block for ts ${timestamp} → #${blockNumber}`)

    // 2) Enumerate holders directly
    const holders = await getBAYCHoldersDirect(blockNumber)
    console.log(`🎉 Found ${holders.length} unique holders`)

    // 3) Get ETH balances using individual RPC calls
    console.log(`⏳ Fetching balances for ${holders.length} addresses...`)
    const totalBalance = await getAllBalances(holders, blockNumber)

    // 4) Format and respond
    const totalEth = ethers.utils.formatEther(totalBalance)

    const executionTime = Date.now() - startTs
    console.log(`✅ Completed in ${(executionTime/1000).toFixed(1)}s`)

    const result: ResultData = {
      totalEth,
      holderCount: holders.length,
      sampledHolders: holders.length,
      executionTime,
      block: blockNumber,
      implementation: 'basic'
    }
    
    // Save result for caching
    await saveResultsToFile('basic', timestamp, result)
    
    return res.status(200).json(result)
  } catch (error) {
    console.error('Error processing request:', error)
    return res.status(500).json({ error: (error as Error).message })
  }
}
