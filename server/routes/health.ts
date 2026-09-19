import { Router } from 'express';
import { execSync } from 'node:child_process';

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

function getToolsStatus() {
  const isPython = checkBinary('python3');
  const isOpenCv = checkOpenCv();
  const isHeif = checkBinary('heif-convert');
  const isOcrmypdf = checkBinary('ocrmypdf');
  const isTesseract = checkTesseractWithDeu();

  return {
    python: isPython,
    python3: isPython,
    opencv: isOpenCv,
    'heif-convert': isHeif,
    ocrmypdf: isOcrmypdf,
    tesseract: isTesseract,
  };
}

healthRouter.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: '0.1.0',
    app: 'Scanny',
    tools: getToolsStatus(),
  });
});

