const statusEl = document.getElementById('status');
const fileInput = document.getElementById('csvFile');
const clearBtn = document.getElementById('clearBtn');

function countRows(text) {
  if (!text || !text.trim()) return 0;
  // rough line count minus header, good enough for status display
  return text.split(/\r\n|\n/).filter(l => l.trim() !== '').length - 1;
}

function refreshStatus() {
  chrome.storage.local.get('ebirdCategoryCsv', (result) => {
    const text = result.ebirdCategoryCsv || '';
    const n = countRows(text);
    statusEl.textContent = n > 0 ? `Loaded: ${n} species from CSV.` : 'No CSV loaded yet.';
  });
}

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    chrome.storage.local.set({ ebirdCategoryCsv: reader.result }, refreshStatus);
  };
  reader.readAsText(file);
});

clearBtn.addEventListener('click', () => {
  chrome.storage.local.set({ ebirdCategoryCsv: '' }, refreshStatus);
});

refreshStatus();
