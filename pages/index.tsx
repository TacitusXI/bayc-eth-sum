import { useState, useEffect } from 'react';
import { implementations, Implementation } from '../lib/implementations';
import Head from 'next/head';
import Header from '../components/Header';
import ImplementationCard from '../components/ImplementationCard';
import PerformanceChart from '../components/PerformanceChart';

// Define types for results
interface ResultData {
  totalEth: string;
  holderCount: number;
  sampledHolders?: number;
  block?: number;
  blockNumber?: number;
  executionTime: number;
  fromCache?: boolean;
  implementation?: string;
  timestamp?: string;
  implementationNotes?: string;
  isMock?: boolean;
}

interface Results {
  [key: string]: ResultData;
}

interface LoadingState {
  [key: string]: boolean;
}

interface ErrorState {
  [key: string]: string | null;
}

interface Preset {
  label: string;
  value: number;
}

// Helper function to convert from unix to readable date
const formatDate = (timestamp: number): string => {
  return new Date(timestamp * 1000).toLocaleString();
};

// Preset timestamps
const presets: Preset[] = [
  { label: 'Jan 1, 2022', value: 1640995200 },
  { label: 'Jul 1, 2022', value: 1656633600 },
  { label: 'Jul 1, 2023', value: 1688169600 },
  { label: 'Apr 25, 2025', value: 1745280000 },
  { label: 'Now', value: Math.floor(Date.now() / 1000) },
];

const dateOptions = [
  { label: 'Current', value: Math.floor(Date.now() / 1000) },
  { label: 'Jan 1, 2022', value: 1640995200 },
  { label: 'Jul 1, 2022', value: 1656633600 },
  { label: 'Jul 1, 2023', value: 1688169600 },
  { label: 'Jan 1, 2024', value: 1704067200 },
  { label: 'Jan 1, 2025', value: 1735689600 },
  { label: 'Apr 25, 2025', value: 1745280000 },
];

export default function Home() {
  const [timestamp, setTimestamp] = useState<number>(1745280000); // Default to Apr 25, 2025
  const [results, setResults] = useState<Results>({});
  const [loading, setLoading] = useState<LoadingState>({});
  const [error, setError] = useState<ErrorState>({});
  
  // Custom timestamp setter to reset results when timestamp changes
  const handleTimestampChange = (newTimestamp: number) => {
    if (newTimestamp !== timestamp) {
      // Clear results when timestamp changes
      setResults({});
      setTimestamp(newTimestamp);
    }
  };

  // Load saved results when component mounts or timestamp changes
  useEffect(() => {
    async function loadSavedResults() {
      try {
        const response = await fetch('/api/get-saved-results');
        if (response.ok) {
          const savedResults = await response.json();
          if (savedResults && Object.keys(savedResults).length > 0) {
            // For each implementation, get the result for current timestamp
            const loadedResults: Results = {};
            
            implementations.forEach(impl => {
              const implResults = savedResults[impl.id];
              if (implResults && implResults[timestamp]) {
                loadedResults[impl.id] = {
                  ...implResults[timestamp],
                  fromCache: true
                };
              }
            });
            
            if (Object.keys(loadedResults).length > 0) {
              setResults(loadedResults);
            }
          }
        }
      } catch (error) {
        console.error('Error loading saved results:', error);
      }
    }
    
    loadSavedResults();
  }, [timestamp]);
  
  const runImplementation = async (implementation: Implementation) => {
    setLoading(prev => ({ ...prev, [implementation.id]: true }));
    setError(prev => ({ ...prev, [implementation.id]: null }));
    
    try {
      const response = await fetch(implementation.source, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          timestamp,
          useCache: false // Force recalculation
        }),
      });
      
      if (!response.ok) {
        // Check if the response is JSON or another format like HTML
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(errorData.message || errorData.error || 'Failed to run implementation');
        } else {
          // Handle non-JSON responses (like HTML error pages)
          const errorText = await response.text();
          console.error(`Non-JSON error response: ${errorText.slice(0, 200)}...`);
          throw new Error(`Server error (${response.status}): ${response.statusText}`);
        }
      }
      
      const result = await response.json();
      setResults(prev => ({ ...prev, [implementation.id]: result }));
    } catch (error) {
      console.error(`Error running ${implementation.id}:`, error);
      setError(prev => ({ ...prev, [implementation.id]: (error as Error).message }));
    } finally {
      setLoading(prev => ({ ...prev, [implementation.id]: false }));
    }
  };
  
  const handleRunAll = async () => {
    // Run all implementations
    for (const impl of implementations) {
      await runImplementation(impl);
    }
  };
  
  // Get implementations with results for sorting
  const implementationsWithResults = implementations.map(impl => ({
    ...impl,
    result: results[impl.id],
    hasResult: !!results[impl.id],
  }));
  
  // Sort implementations: first those with results by execution time, then the rest by status
  const sortedImplementations = [...implementationsWithResults].sort((a, b) => {
    // If both have results, sort by execution time
    if (a.hasResult && b.hasResult) {
      return a.result.executionTime - b.result.executionTime;
    }
    // If only one has result, it goes first
    if (a.hasResult) return -1;
    if (b.hasResult) return 1;
    // If neither has results, implemented goes before planned
    if (a.status === 'implemented' && b.status !== 'implemented') return -1;
    if (a.status !== 'implemented' && b.status === 'implemented') return 1;
    // Default sort by ID
    return a.id.localeCompare(b.id);
  });
  
  return (
    <div className="app">
      <Header />
      
      <main className="main">
        <div className="container">
          <div className="hero">
            <h1 className="title">BAYC Holders ETH Value Calculator</h1>
            <p className="subtitle">
              Calculate the total ETH value held by all Bored Ape Yacht Club holders at any point in time.
              Compare different implementation approaches and their performance.
            </p>
          </div>
          
          <div className="timestamp-selector">
            <div className="input-group">
              <label className="input-label">
                Enter UNIX Timestamp:
                <input 
                  type="number" 
                  value={timestamp} 
                  onChange={(e) => handleTimestampChange(parseInt(e.target.value))}
                  className="timestamp-input"
                />
              </label>
              <div className="timestamp-preview">
                {formatDate(timestamp)}
              </div>
            </div>
            
            <div className="timestamp-presets">
              {presets.map((preset) => (
                <button 
                  key={preset.label}
                  onClick={() => handleTimestampChange(preset.value)}
                  className={timestamp === preset.value ? 'preset-btn active' : 'preset-btn'}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            
            <button className="run-all-btn" onClick={handleRunAll}>
              Run All Implementations
            </button>
          </div>
          
          {/* Performance Chart */}
          {Object.keys(results).length > 1 && (
            <PerformanceChart results={results} />
          )}
          
          {/* Implementation Cards */}
          <div className="implementation-section">
            <h2 className="section-title">Implementation Approaches</h2>
            
            <div className="implementation-grid">
              {sortedImplementations.map((implementation) => (
                <ImplementationCard
                  key={implementation.id}
                  implementation={implementation}
                  result={implementation.hasResult ? implementation.result : null}
                  loading={!!loading[implementation.id]}
                  error={error[implementation.id]}
                  onRun={() => runImplementation(implementation)}
                />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 