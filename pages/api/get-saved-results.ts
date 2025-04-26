import fs from 'fs';
import path from 'path';

// Use the same path as in implementation files
const RESULTS_FILE_PATH = path.join(process.cwd(), 'data', 'results.json');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Check if results file exists
    if (fs.existsSync(RESULTS_FILE_PATH)) {
      const fileContent = fs.readFileSync(RESULTS_FILE_PATH, 'utf8');
      const results = JSON.parse(fileContent);
      return res.status(200).json(results);
    } else {
      // Return empty object if no results file exists yet
      return res.status(200).json({});
    }
  } catch (error) {
    console.error('Error reading results file:', error);
    return res.status(500).json({ 
      message: 'Error reading saved results', 
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
} 