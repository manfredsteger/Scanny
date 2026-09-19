import { Router } from 'express';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { SCAN_PY_PATH } from '../pipeline/processDocument.js';

export const healthRouter = Router();

function checkBinary(binary: string): boolean {
  try {
    execSync(`which ${binary}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkOpenCv(): boolean {
  try {
    execSync('python3 -c "import cv2"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function checkTesseractWithDeu(): boolean {
  try {
    const output = execSync('tesseract --list-langs', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return output.toLowerCase().includes('deu');
  } catch {
    return false;
  }
}

function checkScanPy(): boolean {
  try {
    return fs.existsSync(SCAN_PY_PATH);
  } catch {
    return false;
  }
}

function computeToolsStatus() {
  const isPython = checkBinary('python3');
  const isOpenCv = checkOpenCv();
  const isHeif = checkBinary('heif-convert');
  const isOcrmypdf = checkBinary('ocrmypdf');
  const isTesseract = checkTesseractWithDeu();
  const isScanPy = checkScanPy();

  return {
    python: isPython,
    python3: isPython,
    opencv: isOpenCv,
    'heif-convert': isHeif,
    ocrmypdf: isOcrmypdf,
    tesseract: isTesseract,
    'scan.py': isScanPy,
  };
}

// Tool-Prüfung EINMAL beim Serverstart ausführen und im Speicher cachen
const cachedToolsStatus = computeToolsStatus();

healthRouter.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: '0.1.0',
    app: 'Scanny',
    tools: cachedToolsStatus,
  });
});

