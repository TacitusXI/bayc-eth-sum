require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');
const cache = require('./cache');

// Constants
const BAYC_CONTRACT_ADDRESS = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const ETHERSCAN_API_URL = 'https://api.etherscan.io/api';
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || '';
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || '';
const ALCHEMY_API_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// Provider for blockchain interactions
const provider = new ethers.providers.JsonRpcProvider(ALCHEMY_API_URL);

/**
 * Get block number at timestamp using Etherscan
 * @param {number} timestamp - UNIX timestamp in seconds
 * @returns {Promise<number>} - Block number
 */
async function getBlockNumberAtTimestamp(timestamp) {
  return cache.getOrCompute(timestamp, 'block', async () => {
    try {
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
    } catch (error) {
      console.error('Error getting block number:', error);
      throw error;
    }
  });
}

/**
 * Get all BAYC token transfers up to the given timestamp
 * @param {number} timestamp - UNIX timestamp in seconds
 * @returns {Promise<Array>} - Array of token transfers
 */
async function getBAYCHolders(timestamp) {
  return cache.getOrCompute(timestamp, 'holders', async () => {
    const blockNumber = await getBlockNumberAtTimestamp(timestamp);
    console.log(`Searching for transfers until block ${blockNumber}`);

    // We will keep track of the current owner of each token
    const owners = {};
    let page = 1;
    let hasMoreData = true;

    try {
      while (hasMoreData) {
        const response = await axios.get(ETHERSCAN_API_URL, {
          params: {
            module: 'account',
            action: 'tokennfttx',
            contractaddress: BAYC_CONTRACT_ADDRESS,
            page,
            offset: 1000, // Max records per page
            sort: 'asc',
            apikey: ETHERSCAN_API_KEY
          }
        });

        const transfers = response.data.result;
        
        if (!transfers || transfers.length === 0) {
          hasMoreData = false;
          continue;
        }

        // Process transfers up to the block at specified timestamp
        for (const transfer of transfers) {
          if (parseInt(transfer.blockNumber) > blockNumber) {
            hasMoreData = false;
            break;
          }
          
          const tokenId = transfer.tokenID;
          const to = transfer.to.toLowerCase();
          
          // Update the current owner
          owners[tokenId] = to;
        }

        page++;
        
        // Respect rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Get unique owners
      return [...new Set(Object.values(owners))];

    } catch (error) {
      console.error('Error fetching BAYC transfers:', error);
      throw error;
    }
  });
}

/**
 * Get ETH balance of an address at a specific block
 * @param {string} address - Ethereum address
 * @param {number} blockNumber - Block number
 * @returns {Promise<ethers.BigNumber>} - Balance in wei
 */
async function getEthBalance(address, blockNumber) {
  try {
    const balance = await provider.getBalance(address, blockNumber);
    return balance;
  } catch (error) {
    console.error(`Error getting balance for ${address}:`, error);
    return ethers.BigNumber.from(0);
  }
}

/**
 * Get total ETH value of all BAYC holders at timestamp
 * @param {number} timestamp - UNIX timestamp in seconds
 * @returns {Promise<string>} - Total ETH value in ETH
 */
async function getTotalEthValueOfHolders(timestamp) {
  return cache.getOrCompute(timestamp, 'total_eth', async () => {
    try {
      // Get block number for the timestamp
      const blockNumber = await getBlockNumberAtTimestamp(timestamp);
      console.log(`Block number at timestamp ${timestamp}: ${blockNumber}`);

      // Get all holders at the timestamp
      const holders = await getBAYCHolders(timestamp);
      console.log(`Found ${holders.length} BAYC holders at the specified time`);

      // Get ETH balance for each holder
      let totalBalance = ethers.BigNumber.from(0);
      
      // Process in batches to avoid rate limits
      const batchSize = 20;
      for (let i = 0; i < holders.length; i += batchSize) {
        const batch = holders.slice(i, i + batchSize);
        const balances = await Promise.all(
          batch.map(address => getEthBalance(address, blockNumber))
        );
        
        for (const balance of balances) {
          totalBalance = totalBalance.add(balance);
        }
        
        console.log(`Processed ${Math.min(i + batchSize, holders.length)} of ${holders.length} addresses`);
        
        // Respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Convert from wei to ETH
      return ethers.utils.formatEther(totalBalance);
    } catch (error) {
      console.error('Error in getTotalEthValueOfHolders:', error);
      throw error;
    }
  });
}

/**
 * Main function
 */
async function main() {
  try {
    // Get timestamp from command line argument
    const timestamp = parseInt(process.argv[2]);
    
    if (!timestamp || isNaN(timestamp)) {
      console.error('Please provide a valid UNIX timestamp as an argument');
      console.log('Usage: node index-cached.js <timestamp>');
      process.exit(1);
    }
    
    // Get options
    const forceRefresh = process.argv.includes('--force-refresh');
    if (forceRefresh) {
      console.log('Forcing refresh of cached data');
      cache.clearCache(timestamp, 'total_eth');
      cache.clearCache(timestamp, 'holders');
      cache.clearCache(timestamp, 'block');
    }
    
    console.log(`Calculating total ETH value for BAYC holders at timestamp ${timestamp}`);
    const date = new Date(timestamp * 1000);
    console.log(`Date: ${date.toUTCString()}`);
    
    const totalEth = await getTotalEthValueOfHolders(timestamp);
    console.log(`\nTotal ETH value: ${totalEth} ETH`);
    
  } catch (error) {
    console.error('An error occurred:', error);
    process.exit(1);
  }
}

// Run the main function
main(); 