
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
    const isUnderReview = panel.querySelector(
        'input[data-type="misid"][disabled]'
    ) !== null;
    if (isUnderReview) {
       img.style.border = "5px solid orange";
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


(() => {
       
    const section = document.querySelector('section[aria-labelledby="primary-details"]');
    if (!section) return;

    const submitLink = section.querySelector('a[href^="/submit"]');
    if (!submitLink) return;

    // Extract locID from the URL
    const url = new URL(submitLink.href, window.location.origin);
    const locID = url.searchParams.get('locID');
    if (!locID) return;

    // Create the new link
    const editLink = document.createElement('a');
    editLink.href = `https://ebird.org/mylocations/edit/${locID}`;
    editLink.textContent = 'See the location';
    editLink.target = '_blank';

    // Match eBird button styling
    editLink.className = submitLink.className;
    editLink.style.marginLeft = '0.5rem';

    // Insert it right after the "submit" link
    submitLink.insertAdjacentElement('afterend', editLink);
})();
