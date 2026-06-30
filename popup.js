document.addEventListener('DOMContentLoaded', () => {
    const checkbox = document.getElementById('toggleScript');
    const label = document.getElementById('statusLabel');

    chrome.storage.local.get(['scriptEnabled'], (result) => {
        const isEnabled = result.scriptEnabled !== false;
        checkbox.checked = isEnabled;
        label.innerText = isEnabled ? "Enable" : "Disable";
    });

    checkbox.addEventListener('change', () => {
        const isEnabled = checkbox.checked;
        label.innerText = isEnabled ? "Enable" : "Disable";

        chrome.storage.local.set({ scriptEnabled: isEnabled }, () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].id && tabs[0].url && tabs[0].url.includes('cybershoke.net')) {
                    chrome.tabs.reload(tabs[0].id);
                }
            });
        });
    });
});