// Define the implementation interface
export interface Implementation {
  id: string;
  name: string;
  description: string;
  status: 'implemented' | 'planned';
  source: string;
  estimate?: string;
}

// Define all the available implementations
export const implementations: Implementation[] = [
  {
    id: 'basic',
    name: 'Individual RPC Calls',
    description: 'Makes individual RPC calls for each token and holder. Queries token ownership with direct contract calls and ETH balances one-by-one. Simplest but slowest method.',
    status: 'implemented',
    source: '/api/implementations/basic',
  },
  {
    id: 'graph',
    name: 'Hybrid Graph+Multicall',
    description: 'Uses The Graph for token ownership data and Multicall contracts to batch ETH balance requests in a single call. Combines efficiency of both approaches.',
    status: 'implemented',
    source: '/api/implementations/graph',
  },
  {
    id: 'multicall',
    name: 'Full Multicall Implementation',
    description: 'Uses only Multicall contracts for both token ownership lookups and ETH balance fetching without any external services. Queries everything directly from the Ethereum network in efficient batches.',
    status: 'implemented',
    source: '/api/implementations/multicall',
  },
  {
    id: 'optimizedSolution',
    name: 'Optimized Implementation',
    description: 'Enhanced implementation based on the Graph+Multicall approach with optimized batch processing and improved error handling. Designed for maximum performance and reliability.',
    status: 'implemented',
    source: '/api/implementations/optimizedSolution',
  }
];

// Helper function to get implementation by ID
export const getImplementationById = (id: string): Implementation | null => {
  return implementations.find(impl => impl.id === id) || null;
};

// Helper function to get only implemented methods
export const getImplementedMethods = (): Implementation[] => {
  return implementations.filter(impl => impl.status === 'implemented');
};

// Helper function to get planned methods
export const getPlannedMethods = (): Implementation[] => {
  return implementations.filter(impl => impl.status === 'planned');
}; 