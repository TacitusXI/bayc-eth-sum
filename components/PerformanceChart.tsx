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
  ChartData,
  ChartOptions
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

interface ResultItem {
  executionTime: number;
  totalEth: string;
  holderCount: number;
  block?: number;
  blockNumber?: number;
  fromCache?: boolean;
}

interface Results {
  [id: string]: ResultItem;
}

interface ComparisonData {
  executionDiff: number;
  fasterImplementation: string;
  speedupFactor: string;
  holderCountDiff: number;
  totalEthDiff: string;
}

interface ChartInfo {
  executionTimes: number[];
  relativePerformance: number[];
  labels: string[];
  implementations: string[];
}

interface PerformanceChartProps {
  results: Results;
}

type ViewMode = 'executionTime' | 'relativeSpeed';

const PerformanceChart: React.FC<PerformanceChartProps> = ({ results }) => {
  const [chartData, setChartData] = useState<ChartData<'bar'>>({
    labels: [],
    datasets: [],
  });
  
  const [viewMode, setViewMode] = useState<ViewMode>('executionTime');
  const [comparisonData, setComparisonData] = useState<ComparisonData | null>(null);
  const [chartInfo, setChartInfo] = useState<ChartInfo>({
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
      if (id === 'graph') return 'Hybrid Graph+Multicall';
      if (id === 'multicall') return 'Full Multicall';
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
    const pureMulticallResult = results['multicall'];
    const multicallResult = results['multicall'];
    
    if (pureMulticallResult && multicallResult) {
      const comparison: ComparisonData = {
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
  const updateChartData = (
    mode: ViewMode, 
    labels: string[], 
    implementations: string[], 
    executionTimes: number[], 
    relativePerformance: number[]
  ) => {
    // Colors based on implementation
    const getColor = (id: string): string => {
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

  const getOptions = (): ChartOptions<'bar'> => {
    const baseOptions: ChartOptions<'bar'> = {
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
              const value = context.raw as number;
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
              const labelText = context.chart.data.labels?.[index] as string;
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
            callback: function(tickValue: string | number) {
              const value = Number(tickValue);
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

  return (
    <div className="performance-chart">
      <div className="chart-controls">
        <h3>Performance Comparison</h3>
        <div className="view-toggle">
          <button 
            className={`toggle-button ${viewMode === 'executionTime' ? 'active' : ''}`}
            onClick={() => setViewMode('executionTime')}
          >
            Execution Time
          </button>
          <button 
            className={`toggle-button ${viewMode === 'relativeSpeed' ? 'active' : ''}`}
            onClick={() => setViewMode('relativeSpeed')}
          >
            Relative Speed
          </button>
        </div>
      </div>

      <div className="chart-container">
        {chartData.labels && chartData.labels.length > 0 ? (
          <Bar data={chartData} options={getOptions()} />
        ) : (
          <div className="no-data">Run implementations to see performance comparison</div>
        )}
      </div>

      {comparisonData && (
        <div className="comparison">
          <h4>Implementation Comparison</h4>
          <p>
            <span className="highlight">{comparisonData.fasterImplementation === 'pure-multicall' ? 'Full Multicall' : 'Hybrid Graph+Multicall'}</span> 
            is <span className="highlight">{comparisonData.speedupFactor}x faster</span> 
            ({(comparisonData.executionDiff/1000).toFixed(2)}s difference)
          </p>
          {comparisonData.holderCountDiff > 0 && (
            <p>
              Holder difference: <span className="highlight">{comparisonData.holderCountDiff}</span> accounts
              <br />
              ETH total difference: <span className="highlight">{comparisonData.totalEthDiff}</span> ETH
            </p>
          )}
          <p className="note">
            <strong>Note:</strong> Differences in holder count can affect accuracy. The hybrid implementation may be more accurate due to The Graph's comprehensive data indexing.
          </p>
        </div>
      )}

      <style jsx>{`
        .performance-chart {
          background-color: var(--card-bg);
          border-radius: var(--border-radius);
          padding: 1.5rem;
          box-shadow: var(--shadow);
          margin-top: 2rem;
        }
        
        .chart-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.5rem;
        }
        
        .chart-controls h3 {
          margin: 0;
          font-size: 1.25rem;
          color: var(--foreground);
        }
        
        .view-toggle {
          display: flex;
          border-radius: var(--border-radius);
          overflow: hidden;
          border: 1px solid var(--border-color);
        }
        
        .toggle-button {
          padding: 0.5rem 1rem;
          background: none;
          border: none;
          font-size: 0.875rem;
          cursor: pointer;
          color: var(--foreground);
        }
        
        .toggle-button.active {
          background-color: var(--primary);
          color: white;
        }
        
        .toggle-button:hover:not(.active) {
          background-color: var(--gray-100);
        }
        
        .chart-container {
          height: 400px;
          margin-bottom: 1.5rem;
          position: relative;
        }
        
        .no-data {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--gray-500);
          font-style: italic;
          text-align: center;
          padding: 2rem;
        }
        
        .comparison {
          background-color: var(--card-bg-hover);
          padding: 1.25rem;
          border-radius: var(--border-radius);
          margin-top: 1.5rem;
        }
        
        .comparison h4 {
          margin-top: 0;
          margin-bottom: 0.75rem;
          font-size: 1.125rem;
          color: var(--foreground);
        }
        
        .comparison p {
          margin: 0.5rem 0;
          font-size: 0.875rem;
          color: var(--gray-700);
        }
        
        .highlight {
          color: var(--primary);
          font-weight: 600;
        }
        
        .note {
          margin-top: 1rem;
          font-size: 0.8125rem;
          color: var(--gray-600);
          padding-top: 0.75rem;
          border-top: 1px solid var(--border-color);
        }
      `}</style>
    </div>
  );
};

export default PerformanceChart; 