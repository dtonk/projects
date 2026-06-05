// Minimal types for the File Handling API (window.launchQueue),
// used so Android PWA "Open with" can hand us a CSV file.
interface LaunchParams {
  files?: FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}
