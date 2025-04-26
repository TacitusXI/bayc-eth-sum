# BAYC Holders ETH Value Calculator

This application calculates the total ETH value in all Bored Ape Yacht Club (BAYC) NFT holders' wallets at a specific timestamp.

## Features
- Get all BAYC holders at a specific time
- Calculate the total ETH balance in their wallets at that time
- Uses Ethereum blockchain data for accuracy

## Requirements
- Node.js (v14+)
- NPM or Yarn
- Etherscan API key
- Alchemy or Infura API key

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create `.env` file with your API keys:
   ```
   ETHERSCAN_API_KEY=your_etherscan_api_key
   ALCHEMY_API_KEY=your_alchemy_api_key
   ```

## Usage

Run the application with a UNIX timestamp as the input:

```
node index.js 1651363200
```

This will return the total ETH value held by all BAYC holders at the specified timestamp (in this example, May 1, 2022). 