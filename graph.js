require('dotenv').config();
const { ethers } = require('ethers');
const axios = require('axios');

// Constants
const BAYC_CONTRACT_ADDRESS = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
const ETHERSCAN_API_URL = 'https://api.etherscan.io/api';
const GRAPH_URL = 'https://api.thegraph.com/subgraphs/name/treppers/bayc';
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
 * Get all BAYC holders at a specific block using The Graph
 * @param {number} blockNumber - Block number
 * @returns {Promise<string[]>} - Array of holder addresses
 */
async function getBAYCHoldersAtBlock(blockNumber) {
  try {
    // GraphQL query to get all tokens and their owners at a specific block
    const query = `
      {
        tokens(first: 100, block: { number: ${blockNumber} }) {
          id
          owner {
            id
          }
        }
      }
    `;

    // Alternative direct REST query if The Graph has issues
    const response = await axios.post(GRAPH_URL, { query });
    
    if (response.data.errors) {
      throw new Error(`Graph API error: ${JSON.stringify(response.data.errors)}`);
    }

    // Extract unique owner addresses
    const holders = response.data.data.tokens.map(token => token.owner.id.toLowerCase());
    return [...new Set(holders)];
  } catch (error) {
    console.error('Error fetching BAYC holders from The Graph:', error);
    
    // Fallback to direct contract query if The Graph is unavailable
    return getBAYCHoldersFromContract(blockNumber);
  }
}

/**
 * Fallback method to get BAYC holders by querying the contract directly
 * @param {number} blockNumber - Block number
 * @returns {Promise<string[]>} - Array of holder addresses
 */
async function getBAYCHoldersFromContract(blockNumber) {
  try {
    console.log('Falling back to direct contract query for BAYC holders');
    
    // BAYC contract ABI for ownerOf function
    const abi = [
      'function ownerOf(uint256 tokenId) view returns (address)',
      'function totalSupply() view returns (uint256)'
    ];
    
    const contract = new ethers.Contract(BAYC_CONTRACT_ADDRESS, abi, provider);
    
    // Get total supply
    const totalSupply = await contract.totalSupply({ blockTag: blockNumber });
    
    // Get owner of each token
    const owners = new Set();
    const batchSize = 100;
    
    for (let i = 0; i < totalSupply.toNumber(); i += batchSize) {
      const promises = [];
      
      for (let j = i; j < Math.min(i + batchSize, totalSupply.toNumber()); j++) {
        promises.push(
          contract.ownerOf(j, { blockTag: blockNumber })
            .then(owner => owners.add(owner.toLowerCase()))
            .catch(() => {}) // Skip if token doesn't exist
        );
      }
      
      await Promise.all(promises);
      console.log(`Processed ${Math.min(i + batchSize, totalSupply.toNumber())} of ${totalSupply.toNumber()} tokens`);
      
      // Respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return Array.from(owners);
  } catch (error) {
    console.error('Error in direct contract query:', error);
    throw error;
  }
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
  try {
    // Get block number for the timestamp
    const blockNumber = await getBlockNumberAtTimestamp(timestamp);
    console.log(`Block number at timestamp ${timestamp}: ${blockNumber}`);
    
    // Get all holders at the specified block
    const holders = await getBAYCHoldersAtBlock(blockNumber);
    console.log(`Found ${holders.length} BAYC holders at block ${blockNumber}`);
    
    // Get ETH balance for each holder
    let totalBalance = ethers.BigNumber.from(0);
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
}

// Main function
async function main() {
  try {
    // Get timestamp from command line argument
    const timestamp = parseInt(process.argv[2]);
    
    if (!timestamp || isNaN(timestamp)) {
      console.error('Please provide a valid UNIX timestamp as an argument');
      console.log('Usage: node graph.js <timestamp>');
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