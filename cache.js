const fs = require('fs');
const path = require('path');

// Cache directory
const CACHE_DIR = path.join(__dirname, 'cache');

/**
 * Initialize the cache directory
 */
function initCache() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Generate a cache key for a timestamp
 * @param {number} timestamp - UNIX timestamp 
 * @param {string} type - Cache type (e.g., 'holders', 'balance')
 * @returns {string} - Cache key
 */
function getCacheKey(timestamp, type) {
  return path.join(CACHE_DIR, `${type}_${timestamp}.json`);
}

/**
 * Get data from cache
 * @param {number} timestamp - UNIX timestamp
 * @param {string} type - Cache type
 * @returns {any|null} - Cached data or null if not found
 */
function getFromCache(timestamp, type) {
  const cacheKey = getCacheKey(timestamp, type);
  
  if (fs.existsSync(cacheKey)) {
    try {
      const data = fs.readFileSync(cacheKey, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Error reading from cache: ${error.message}`);
      return null;
    }
  }
  
  return null;
}

/**
 * Save data to cache
 * @param {number} timestamp - UNIX timestamp
 * @param {string} type - Cache type
 * @param {any} data - Data to cache
 */
function saveToCache(timestamp, type, data) {
  initCache();
  const cacheKey = getCacheKey(timestamp, type);
  
  try {
    fs.writeFileSync(cacheKey, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing to cache: ${error.message}`);
  }
}

/**
 * Clear cache for a specific timestamp and type
 * @param {number} timestamp - UNIX timestamp
 * @param {string} type - Cache type
 */
function clearCache(timestamp, type) {
  const cacheKey = getCacheKey(timestamp, type);
  
  if (fs.existsSync(cacheKey)) {
    try {
      fs.unlinkSync(cacheKey);
    } catch (error) {
      console.error(`Error clearing cache: ${error.message}`);
    }
  }
}

/**
 * Get or compute data with caching
 * @param {number} timestamp - UNIX timestamp
 * @param {string} type - Cache type
 * @param {Function} computeFunc - Function to compute data if not cached
 * @returns {Promise<any>} - Data (from cache or computed)
 */
async function getOrCompute(timestamp, type, computeFunc) {
  // Check cache first
  const cachedData = getFromCache(timestamp, type);
  
  if (cachedData) {
    console.log(`Using cached ${type} data for timestamp ${timestamp}`);
    return cachedData;
  }
  
  // Compute data
  console.log(`Computing ${type} data for timestamp ${timestamp}`);
  const data = await computeFunc();
  
  // Save to cache
  saveToCache(timestamp, type, data);
  
  return data;
}

module.exports = {
  getFromCache,
  saveToCache,
  clearCache,
  getOrCompute
}; 