require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');

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
 */
async function getBlockNumberAtTimestamp(timestamp) {
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
}

/**
 * Get all BAYC transfers up to a certain block
 */
async function getBAYCTransfers(blockNumber) {
  try {
    const response = await axios.get(ETHERSCAN_API_URL, {
      params: {
        module: 'account',
        action: 'tokennfttx',
        contractaddress: BAYC_CONTRACT_ADDRESS,
        page: 1,
        offset: 10000,
        sort: 'asc',
        apikey: ETHERSCAN_API_KEY
      }
    });

    if (response.data.status !== '1') {
      throw new Error(`Etherscan API error: ${response.data.message}`);
    }

    // Filter transfers up to the specified block
    return response.data.result.filter(tx => parseInt(tx.blockNumber) <= blockNumber);
  } catch (error) {
    console.error('Error getting BAYC transfers:', error);
    throw error;
  }
}

/**
 * Get ETH balance of an address at a specific block
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
 */
async function getTotalEthValueOfHolders(timestamp) {
  try {
    // Get block number for the timestamp
    const blockNumber = await getBlockNumberAtTimestamp(timestamp);
    console.log(`Block number at timestamp ${timestamp}: ${blockNumber}`);
    
    // Get all transfers up to the specified block
    const transfers = await getBAYCTransfers(blockNumber);
    console.log(`Found ${transfers.length} transfers up to block ${blockNumber}`);
    
    // Determine the holder of each token at the specified block
    const tokenHolders = {};
    
    for (const transfer of transfers) {
      const tokenId = transfer.tokenID;
      const to = transfer.to.toLowerCase();
      tokenHolders[tokenId] = to;
    }
    
    // Get unique holder addresses
    const holders = [...new Set(Object.values(tokenHolders))];
    console.log(`Found ${holders.length} unique BAYC holders at block ${blockNumber}`);
    
    // Get ETH balance for each holder
    let totalBalance = ethers.BigNumber.from(0);
    
    for (let i = 0; i < holders.length; i++) {
      const address = holders[i];
      const balance = await getEthBalance(address, blockNumber);
      totalBalance = totalBalance.add(balance);
      
      if (i % 10 === 0) {
        console.log(`Processed ${i} of ${holders.length} addresses`);
      }
    }
    
    // Convert from wei to ETH
    return ethers.utils.formatEther(totalBalance);
  } catch (error) {
    console.error('Error in getTotalEthValueOfHolders:', error);
    throw error;
  }
}

// Main function
async function main() {
  try {
    // Get timestamp from command line argument
    const timestamp = parseInt(process.argv[2]);
    
    if (!timestamp || isNaN(timestamp)) {
      console.error('Please provide a valid UNIX timestamp as an argument');
      console.log('Usage: node index.js <timestamp>');
      process.exit(1);
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

// Run main function
main(); 