# BAYC ETH Sum

A high-performance blockchain analytics tool that calculates the total ETH held by Bored Ape Yacht Club NFT holders at any historical timestamp.

![Performance Comparison](/public/images/relative-speed.png)

## Overview

This application demonstrates different approaches to blockchain data aggregation, with performance improvements of up to **1600x** over basic implementations. The optimized solution can deliver results in just **5-15 seconds** compared to hours with traditional methods.

## Implementation Approaches

The project implements four different strategies for calculating the total ETH held by BAYC holders:

### 1. Basic Implementation
- **Technology**: Direct RPC calls with ethers.js
- **Method**: Sequential processing of each token and holder
- **Performance**: Slowest (baseline)
- **Advantages**: Simple to understand and implement
- **Disadvantages**: Extremely slow due to N+1 RPC calls (10,000+ API calls)

### 2. Multicall Implementation
- **Technology**: Multicall3 contract for batched RPC calls
- **Method**: Batches ownerOf() and getBalance() calls
- **Performance**: ~20x faster than basic
- **Advantages**: Significant performance improvement through call batching
- **Disadvantages**: Still requires many contract calls

### 3. Graph Implementation
- **Technology**: TheGraph protocol for indexed blockchain data
- **Method**: GraphQL queries for token ownership data + Multicall for balances
- **Performance**: ~100x faster than basic
- **Advantages**: Much faster token ownership queries through indexed data
- **Disadvantages**: Depends on third-party indexing service

### 4. Optimized Solution
- **Technology**: Hybrid approach with caching, batching, and parallel processing
- **Method**: Intelligent caching, GraphQL for tokens, Multicall for balances
- **Performance**: ~1600x faster than basic (5-15 seconds)
- **Advantages**: Extremely fast, resilient with fallbacks, caches intermediate results
- **Disadvantages**: More complex implementation

## Technology Stack

- **Frontend**: Next.js, React, TailwindCSS
- **Backend**: Next.js API routes (Node.js)
- **Blockchain Interaction**:
  - ethers.js for Ethereum RPC communication
  - Multicall3 for batched contract calls
  - TheGraph for indexed data queries
- **Data Storage**: File-based caching using Node.js fs module
- **APIs**:
  - Alchemy for RPC connections
  - Etherscan for block timestamp resolution
  - TheGraph for indexed BAYC token data

## Getting Started

### Prerequisites

- Node.js v16+
- npm v7+
- Ethereum RPC endpoint (Alchemy API key)
- Etherscan API key
- BAYC subgraph URL (optional for Graph implementation)

### Environment Setup

Create a `.env.local` file in the project root:

```
ALCHEMY_API_KEY=your_alchemy_api_key
ETHERSCAN_API_KEY=your_etherscan_api_key
BAYC_SUBGRAPH_URL=https://api.thegraph.com/subgraphs/name/dabit3/boredapeyachtclub
```

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Usage

1. Open the application in your browser (default: http://localhost:3000)
2. Select a historical timestamp or date
3. Choose an implementation method
4. View the results and performance statistics

## Performance Insights

The optimized solution achieves dramatic performance improvements through:

- Smart caching of intermediate data (blocks, holders, balances)
- Parallel processing where possible
- Batched contract calls using Multicall3
- Progressive enhancement with fallbacks
- Binary search for efficient block number resolution
- Indexed data from TheGraph when available

This results in a **1600x** speedup compared to basic RPC methods, delivering results in **5-15 seconds** instead of hours.

## Development

The project was developed using:

- VSCode
- Next.js development server
- Ethers.js for blockchain interaction
- Vercel for deployment

## License

MIT

## Acknowledgments

- The Ethereum community
- Bored Ape Yacht Club
- TheGraph protocol
- Multicall contract developers 