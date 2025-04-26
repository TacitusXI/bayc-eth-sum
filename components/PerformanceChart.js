import { useState, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const PerformanceChart = ({ results }) => {
  const [chartData, setChartData] = useState({
    labels: [],
    datasets: [],
  });
  
  const [viewMode, setViewMode] = useState('executionTime'); // 'executionTime' or 'relativeSpeed'
  const [comparisonData, setComparisonData] = useState(null);
  const [chartInfo, setChartInfo] = useState({
    executionTimes: [],
    relativePerformance: [],
    labels: [],
    implementations: []
  });

  useEffect(() => {
    // Filter results that have execution time
    const validResults = Object.entries(results).filter(
      ([_, result]) => result && result.executionTime
    );

    if (validResults.length === 0) return;

    // Sort implementations by execution time
    validResults.sort((a, b) => a[1].executionTime - b[1].executionTime);

    // Prepare chart data
    const labels = validResults.map(([id, _]) => {
      // Format implementation names based on new implementation names
      if (id === 'basic') return 'Individual RPC Calls';
      if (id === 'multicall') return 'Hybrid Graph+Multicall';
      if (id === 'pure-multicall') return 'Full Multicall';
      return id.charAt(0).toUpperCase() + id.slice(1);
    });
    
    const implementations = validResults.map(([id, _]) => id);
    const executionTimes = validResults.map(([_, result]) => result.executionTime / 1000); // Convert to seconds
    
    // Get the fastest time for comparison
    const fastestTime = Math.min(...executionTimes);
    
    // Calculate relative performance (how many times faster than the slowest)
    const slowestTime = Math.max(...executionTimes);
    const relativePerformance = executionTimes.map(time => 
      parseFloat((slowestTime / time).toFixed(2))
    );

    // Store all chart data
    setChartInfo({
      executionTimes,
      relativePerformance,
      labels,
      implementations
    });

    // Prepare comparison data for multicall implementations
    const pureMulticallResult = results['pure-multicall'];
    const multicallResult = results['multicall'];
    
    if (pureMulticallResult && multicallResult) {
      const comparison = {
        executionDiff: Math.abs(pureMulticallResult.executionTime - multicallResult.executionTime),
        fasterImplementation: pureMulticallResult.executionTime < multicallResult.executionTime ? 'pure-multicall' : 'multicall',
        speedupFactor: pureMulticallResult.executionTime < multicallResult.executionTime ? 
          (multicallResult.executionTime / pureMulticallResult.executionTime).toFixed(2) :
          (pureMulticallResult.executionTime / multicallResult.executionTime).toFixed(2),
        holderCountDiff: Math.abs(pureMulticallResult.holderCount - multicallResult.holderCount),
        totalEthDiff: Math.abs(parseFloat(pureMulticallResult.totalEth) - parseFloat(multicallResult.totalEth)).toFixed(2)
      };
      setComparisonData(comparison);
    }

    // Update chart based on the current view mode
    updateChartData(viewMode, labels, implementations, executionTimes, relativePerformance);
  }, [results]);

  // Update chart when view mode changes
  useEffect(() => {
    if (chartInfo.labels.length === 0) return;
    
    updateChartData(
      viewMode, 
      chartInfo.labels, 
      chartInfo.implementations, 
      chartInfo.executionTimes, 
      chartInfo.relativePerformance
    );
  }, [viewMode, chartInfo]);

  // Function to update chart data based on view mode
  const updateChartData = (mode, labels, implementations, executionTimes, relativePerformance) => {
    // Colors based on implementation
    const getColor = (id) => {
      if (id === 'multicall') return 'rgba(54, 162, 235, 0.7)'; // Blue for Hybrid
      if (id === 'pure-multicall') return 'rgba(75, 192, 192, 0.7)'; // Teal for Full Multicall
      if (id === 'basic') return 'rgba(255, 99, 132, 0.7)'; // Red for individual RPC calls
      return 'rgba(58, 134, 255, 0.7)'; // Default blue
    };

    if (mode === 'executionTime') {
      setChartData({
        labels,
        datasets: [
          {
            label: 'Execution Time (seconds)',
            data: executionTimes,
            backgroundColor: implementations.map(id => getColor(id)),
            borderColor: implementations.map(id => getColor(id).replace('0.7', '1')),
            borderWidth: 1,
          }
        ],
      });
    } else {
      setChartData({
        labels,
        datasets: [
          {
            label: 'Relative Speed (higher is better)',
            data: relativePerformance,
            backgroundColor: 'rgba(255, 206, 86, 0.7)',
            borderColor: 'rgba(255, 206, 86, 1)',
            borderWidth: 1,
          }
        ],
      });
    }
  };

  const getOptions = () => {
    const baseOptions = {
      responsive: true,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            color: 'rgba(229, 229, 229, 0.8)' // Light color for dark theme
          }
        },
        title: {
          display: true,
          text: viewMode === 'executionTime' 
            ? 'Execution Time Comparison (Log Scale)' 
            : 'Relative Speed Comparison',
          color: 'rgba(229, 229, 229, 0.9)' // Light color for dark theme
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              if (viewMode === 'relativeSpeed') {
                return `Relative Speed: ${context.raw}x faster than slowest`;
              }
              
              // For execution time
              const value = context.raw;
              // Format differently based on the size
              if (value >= 3600) {
                return `Execution time: ${(value/3600).toFixed(1)} hours`;
              } else if (value >= 60) {
                return `Execution time: ${(value/60).toFixed(1)} minutes`;
              } else {
                return `Execution time: ${value.toFixed(2)} seconds`;
              }
            },
            afterLabel: (context) => {
              const index = context.dataIndex;
              const labelText = context.chart.data.labels[index];
              // Convert back to original ID
              let originalId;
              if (labelText === 'Hybrid Graph+Multicall') originalId = 'multicall';
              else if (labelText === 'Full Multicall') originalId = 'pure-multicall';
              else if (labelText === 'Individual RPC Calls') originalId = 'basic';
              else originalId = labelText.toLowerCase();
              
              const result = results[originalId];
              
              if (result) {
                return [
                  `Total ETH: ${parseFloat(result.totalEth).toLocaleString()} ETH`,
                  `Holders: ${result.holderCount.toLocaleString()}`,
                  `Block: ${result.block || result.blockNumber}`,
                  result.fromCache ? 'From cache: Yes' : ''
                ].filter(Boolean);
              }
              return '';
            },
          },
          backgroundColor: 'rgba(30, 30, 30, 0.9)', // Dark background for tooltip
          titleColor: 'rgba(229, 229, 229, 0.9)' // Light text
        },
      },
      scales: {
        y: {
          type: viewMode === 'executionTime' ? 'logarithmic' : 'linear',
          title: {
            display: true,
            text: viewMode === 'executionTime' 
              ? 'Execution Time (seconds - log scale)' 
              : 'Times Faster than Slowest',
            color: 'rgba(229, 229, 229, 0.7)' // Light color for dark theme
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.1)' // Subtle grid lines
          },
          ticks: {
            color: 'rgba(229, 229, 229, 0.7)', // Light text for ticks
            callback: function(value) {
              if (viewMode === 'executionTime') {
                if (value >= 3600) {
                  return `${(value/3600).toFixed(1)}h`;
                } else if (value >= 60) {
                  return `${(value/60).toFixed(1)}m`;
                } else {
                  return `${value}s`;
                }
              }
              return value + 'x'; // For relative speed
            }
          }
        },
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.1)' // Subtle grid lines
          },
          ticks: {
            color: 'rgba(229, 229, 229, 0.7)' // Light text for ticks
          }
        }
      }
    };
    
    return baseOptions;
  };

  // Only render if we have data
  if (chartData.labels.length === 0) {
    return <div className="chart-placeholder">Run implementations to see performance comparison</div>;
  }

  return (
    <div className="chart-section">
      <div className="view-toggle">
        <button 
          className={`toggle-btn ${viewMode === 'executionTime' ? 'active' : ''}`}
          onClick={() => setViewMode('executionTime')}
        >
          Execution Time
        </button>
        <button 
          className={`toggle-btn ${viewMode === 'relativeSpeed' ? 'active' : ''}`}
          onClick={() => setViewMode('relativeSpeed')}
        >
          Relative Speed
        </button>
      </div>
      
      <div className="chart-container">
        <Bar data={chartData} options={getOptions()} />
      </div>
      
      {comparisonData && (
        <div className="comparison-box">
          <h3>Implementation Comparison</h3>
          <div className="comparison-content">
            <p>
              <strong>{comparisonData.fasterImplementation === 'pure-multicall' ? 'Full Multicall' : 'Hybrid Graph+Multicall'}</strong> was <strong>{comparisonData.speedupFactor}x faster</strong> 
              ({(comparisonData.executionDiff / 1000).toFixed(2)} seconds difference)
            </p>
            
            <div className="comparison-details">
              <div className="detail-item">
                <span className="detail-label">Holder Count Difference:</span> 
                <span className="detail-value">{comparisonData.holderCountDiff} addresses</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Total ETH Difference:</span> 
                <span className="detail-value">{comparisonData.totalEthDiff} ETH</span>
              </div>
            </div>
            
            <div className="note">
              <p>Note: The Hybrid Graph+Multicall approach relies on The Graph for token holder data which can be more accurate,
              while the Full Multicall implementation queries everything directly from the blockchain without external services.</p>
            </div>
          </div>
        </div>
      )}
      
      <style jsx>{`
        .chart-section {
          margin-top: 2rem;
        }
        
        .view-toggle {
          display: flex;
          justify-content: center;
          margin-bottom: 1rem;
        }
        
        .toggle-btn {
          background: var(--card-bg);
          border: 1px solid var(--border-color);
          color: var(--text-color);
          padding: 0.5rem 1rem;
          margin: 0 0.5rem;
          border-radius: var(--border-radius);
          cursor: pointer;
          transition: all 0.2s ease;
        }
        
        .toggle-btn:hover {
          background: rgba(255, 255, 255, 0.1);
        }
        
        .toggle-btn.active {
          background: var(--primary);
          color: white;
          border-color: var(--primary);
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
        }
        
        .chart-container {
          background: var(--card-bg);
          border-radius: var(--border-radius);
          padding: 1.5rem;
          box-shadow: var(--shadow);
          margin-bottom: 1.5rem;
        }
        
        .comparison-box {
          background: var(--card-bg);
          border-radius: var(--border-radius);
          padding: 1.5rem;
          box-shadow: var(--shadow);
          color: var(--text-color);
        }
        
        .comparison-box h3 {
          margin-top: 0;
          margin-bottom: 1rem;
          font-size: 1.2rem;
          color: var(--primary);
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 0.5rem;
        }
        
        .comparison-content {
          font-size: 0.95rem;
        }
        
        .comparison-details {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin: 1.5rem 0;
        }
        
        .detail-item {
          display: flex;
          flex-direction: column;
          background: rgba(0, 0, 0, 0.2);
          padding: 0.75rem;
          border-radius: 0.5rem;
        }
        
        .detail-label {
          font-size: 0.8rem;
          color: var(--gray-400);
          margin-bottom: 0.25rem;
        }
        
        .detail-value {
          font-size: 1.1rem;
          font-weight: 600;
        }
        
        .note {
          font-size: 0.85rem;
          font-style: italic;
          opacity: 0.8;
          background: rgba(255, 255, 255, 0.05);
          padding: 0.75rem;
          border-radius: 0.5rem;
          border-left: 3px solid var(--gray-500);
        }
        
        .chart-placeholder {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 300px;
          background: var(--card-bg);
          border-radius: var(--border-radius);
          box-shadow: var(--shadow);
          color: var(--gray-500);
          font-style: italic;
        }
      `}</style>
    </div>
  );
};

export default PerformanceChart; 