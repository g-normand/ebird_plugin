
function waitForMisIDTools(callback) {
    const selector = 'input[id^="misid-input-"]';

    // immediate check
    if (document.querySelector(selector)) {
        callback();
        return;
    }

    // wait for dynamic DOM changes
    const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
            obs.disconnect();
            callback();
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
}


   

waitForMisIDTools(() => {
    // your image-watching code here
    console.log("Running image detection...");
    // Initial scan — delayed 500ms to allow dynamic DOM to appear
    setTimeout(() => {
       document.querySelectorAll("img").forEach(watchImage);
    }, 500);
    
    // Watch dynamic content
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.tagName === "IMG") watchImage(node);
                else if (node.querySelectorAll) node.querySelectorAll("img").forEach(watchImage);
            }
        }
   });
   observer.observe(document.body, { childList: true, subtree: true });
});

function onImageLoaded(img) {
    const link = img.closest('a[data-asset-id]');
    if (!link) return;

    const assetId = link.dataset.assetId;
    if (!assetId) return;

    const panel = document.querySelector(`#PanelFlag-${assetId}`);
    if (!panel) return;

    const text = panel.innerText.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    const flagged = text.includes("this record is already under evaluation");

    if (flagged) {
       img.style.border = "5px solid red";
    }
}

function watchImage(img) {
    if (img.__watched) return;
    img.__watched = true;

    if (img.complete) {
        onImageLoaded(img);
    } else {
        img.addEventListener("load", () => onImageLoaded(img), { once: true });
    }
}

