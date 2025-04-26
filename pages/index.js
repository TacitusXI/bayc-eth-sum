import { useState, useEffect } from 'react';
import { implementations } from '../lib/implementations';
import Head from 'next/head';
import Header from '../components/Header';
import ImplementationCard from '../components/ImplementationCard';
import PerformanceChart from '../components/PerformanceChart';

// Helper function to convert from unix to readable date
const formatDate = (timestamp) => {
  return new Date(timestamp * 1000).toLocaleString();
};

// Preset timestamps
const presets = [
  { label: 'May 1, 2022', value: 1651363200 },
  { label: 'Jan 1, 2023', value: 1672531200 },
  { label: 'May 4, 2023', value: 1683158400 },
  { label: 'Apr 25, 2025', value: 1745280000 },
  { label: 'Now', value: Math.floor(Date.now() / 1000) },
];

export default function Home() {
  const [timestamp, setTimestamp] = useState(1651363200); // Default to May 1, 2022
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});
  const [error, setError] = useState({});
  
  // Custom timestamp setter to reset results when timestamp changes
  const handleTimestampChange = (newTimestamp) => {
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
            const loadedResults = {};
            
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
  
  const runImplementation = async (implementation) => {
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
      setError(prev => ({ ...prev, [implementation.id]: error.message }));
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
                  result={results[implementation.id]}
                  loading={loading[implementation.id]}
                  error={error[implementation.id]}
                  onRun={runImplementation}
                />
              ))}
            </div>
          </div>
        </div>
      </main>
      
      <footer className="footer">
        <div className="container">
          <p className="footer-text">
            Created for assessment demo • Source code on{' '}
            <a 
              href="https://github.com/USERNAME/bayc-eth-sum" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              GitHub
            </a>
          </p>
        </div>
      </footer>
      
      <style jsx>{`
        .app {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        
        .main {
          flex: 1;
          padding: 2rem 0;
        }
        
        .hero {
          text-align: center;
          margin-bottom: 3rem;
        }
        
        .title {
          font-size: 2.5rem;
          font-weight: 800;
          margin-bottom: 1rem;
          background: linear-gradient(to right, var(--primary), var(--secondary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          line-height: 1.2;
          text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
        }
        
        .subtitle {
          font-size: 1.125rem;
          color: var(--gray-600);
          max-width: 800px;
          margin: 0 auto;
          line-height: 1.5;
        }
        
        .timestamp-selector {
          max-width: 600px;
          margin: 0 auto 3rem;
          padding: 2rem;
          background: var(--card-bg);
          border-radius: var(--border-radius);
          box-shadow: var(--shadow);
          border: 1px solid var(--border-color);
        }
        
        .input-group {
          margin-bottom: 1.5rem;
        }
        
        .input-label {
          display: block;
          font-weight: 500;
          margin-bottom: 0.5rem;
          color: var(--gray-700);
        }
        
        .timestamp-input {
          width: 100%;
          margin-top: 0.5rem;
        }
        
        .timestamp-preview {
          margin-top: 0.75rem;
          font-size: 0.875rem;
          color: var(--gray-600);
          text-align: center;
          font-style: italic;
        }
        
        .timestamp-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
          justify-content: center;
        }
        
        .preset-btn {
          background-color: var(--gray-200);
          color: var(--gray-700);
          border: 1px solid var(--border-color);
          border-radius: var(--border-radius);
          padding: 0.5rem 1rem;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .preset-btn:hover {
          background-color: var(--gray-300);
        }
        
        .preset-btn.active {
          background-color: var(--primary);
          color: white;
          border-color: var(--primary);
        }
        
        .run-all-btn {
          width: 100%;
          padding: 0.75rem 1.5rem;
          font-size: 1rem;
          font-weight: 600;
          background: linear-gradient(to right, var(--primary), var(--secondary));
          color: white;
          border: none;
          border-radius: var(--border-radius);
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: var(--shadow-sm);
        }
        
        .run-all-btn:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow);
          filter: brightness(1.1);
        }
        
        .section-title {
          font-size: 1.75rem;
          font-weight: 700;
          margin-bottom: 1.5rem;
          color: var(--foreground);
          position: relative;
          display: inline-block;
        }
        
        .section-title:after {
          content: '';
          position: absolute;
          width: 100%;
          height: 2px;
          bottom: -5px;
          left: 0;
          background: linear-gradient(to right, var(--primary), var(--secondary));
          border-radius: 2px;
        }
        
        .implementation-section {
          margin-top: 3rem;
        }
        
        .implementation-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 1.5rem;
        }
        
        .footer {
          margin-top: 4rem;
          padding: 2rem 0;
          background-color: var(--gray-100);
          border-top: 1px solid var(--border-color);
        }
        
        .footer-text {
          text-align: center;
          color: var(--gray-600);
          font-size: 0.875rem;
        }
        
        @media (max-width: 768px) {
          .title {
            font-size: 2rem;
          }
          
          .implementation-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
} 