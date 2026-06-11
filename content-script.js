
const path = location.pathname;

// ============================================================
// PAGE: /checklist/[id] — flagged pictures + location link
// ============================================================

if (/^\/checklist\/S\d+$/.test(path)) {
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


    (async function photoIdChecker() {
        // --- 1. Get month and day from <time datetime="..."> ---
        const timeEl = document.querySelector('time[datetime]');
        const dateMatch = timeEl?.getAttribute('datetime')?.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (!dateMatch) {
        console.warn('[ebird-plugin] Could not find date');
        return;
        }
        const month = parseInt(dateMatch[2], 10); // "04" → 4
        const day   = parseInt(dateMatch[3], 10); // "11" → 11
        
        
        // --- 2. Get lat/lng from Google Maps link ---
        const mapsLink = document.querySelector('a[href*="maps/search/?api=1&query="]');
        const coordsMatch = mapsLink?.href.match(/query=([-\d.]+),([-\d.]+)/);
        if (!coordsMatch) {
        console.warn('[ebird-plugin] Could not find coordinates');
        return;
        }
        const lat = coordsMatch[1];
        const lng = coordsMatch[2];

        // --- 3. Call the photo-id API ---
        async function callPhotoId(photoId, speciesCode) {
            const url = `https://ebird.org/photo-id/${photoId}/${speciesCode}` +
                `?lat=${lat}&lng=${lng}&m=${month}&d=${day}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();

            const suggestion     = json?.suggestion ?? null;
            const opinion        = json?.opinion ?? null;   // 'confident_agree', 'soft_agree', 'disagree', etc.
            const detection      = json?.detections?.[0];
            const topClass       = detection?.classification?.[0];
            const confidence     = topClass?.confidence_score ?? null;
            const freqScore      = topClass?.frequency_score ?? null;
            const detectionConf  = detection?.detection_confidence ?? null;

            // All alternative suggestions from classification array
            const allSuggestions = detection?.classification?.map(c => ({
                code: c.species_code,
                confidence: c.confidence_score,
                freqScore: c.frequency_score,
            })) ?? [];

            const match = suggestion === speciesCode;

            return { match, opinion, confidence, detectionConf, freqScore, suggested: suggestion, allSuggestions };
        }

        // --- 4. Inject a badge on the photo tile ---
        function injectBadge(sectionEl, state, data) {
            sectionEl.querySelector('.ebird-ai-badge')?.remove();

            // Map opinion → visual state when state === 'match'
            // (state can be: 'loading' | 'match' | 'softmatch' | 'nomatch' | 'error')
            const cfg = {
                loading:   { bg: '#546e7a', text: '… checking' },
                match:     { bg: '#2e7d32', text: '✓ AI agrees' },
                softmatch: { bg: '#f57f17', text: '~ soft agree' },  // NEW
                nomatch:   { bg: '#c62828', text: '✗' },
                error:     { bg: '#e65100', text: '! error' },
            }[state];

            let label = cfg.text;
            let tooltip = '';

            if (state === 'match' && data?.confidence != null) {
                label   = `✓ ${Math.round(data.confidence * 100)}%`;
                tooltip = `AI confidently agrees (${data.opinion})`;
            }
            if (state === 'softmatch' && data?.confidence != null) {
                if (data.match){
                    label = `${Math.round(data.confidence * 100)}%`
                }
                else {
                    label   = `${data?.suggested} (${Math.round(data.confidence * 100)}%)`;
                }
                tooltip = `AI soft-agrees: ${data.suggested ?? '?'}` +
                        (data.confidence != null ? ` (${Math.round(data.confidence * 100)}%)` : '');
            }
            if (state === 'nomatch') {
                label   = `✗ ${data?.suggested ?? '?'}`;
                tooltip = `AI top suggestion: ${data?.suggested ?? 'unknown'}` +
                        (data?.confidence != null ? ` (${Math.round(data.confidence * 100)}%)` : '');
            }

            const badge = document.createElement('div');
            badge.className = 'ebird-ai-badge';
            badge.title = tooltip;
            badge.textContent = label;
            badge.style.cssText = `
                position:absolute; top:6px; left:6px; z-index:9999;
                padding:2px 7px; border-radius:10px;
                font-size:11px; font-weight:bold; font-family:sans-serif;
                color:#fff; background:${cfg.bg};
                box-shadow:0 1px 4px rgba(0,0,0,.45);
                pointer-events:none; white-space:nowrap;
                `;

            const figure = sectionEl.querySelector('.MediaUpload-figure') ?? sectionEl;
            if (getComputedStyle(figure).position === 'static') figure.style.position = 'relative';
            figure.appendChild(badge);
        }

        // --- 5. Process all photo sections currently in the DOM ---
        function processSections() {
            document.querySelectorAll('div[data-media-id]').forEach(mediaDiv => {
                const photoId     = mediaDiv.dataset.mediaId;
                const section = mediaDiv.closest('section.Observation');
                const speciesCode = section?.id; // e.g. "crocht1"
                if (!photoId || !speciesCode) return;

                // Find the <a data-asset-id> inside this same observation block
                const linkEl = mediaDiv.parentElement.querySelector(`a[data-asset-id="${photoId}"]`);
                if (!linkEl) return;
                if (linkEl.querySelector('.ebird-ai-badge')) return; // already done

                injectBadge(linkEl, 'loading', null);
                callPhotoId(photoId, speciesCode)
                .then(result => {
                    const opinionToState = {
                        confident_agree: 'match',
                        soft_agree:      'softmatch',
                        // anything else (disagree, unsure, etc.) → nomatch
                    };
                    const badgeState = result.match
                        ? (opinionToState[result.opinion] ?? 'match')
                        : (opinionToState[result.opinion] ?? 'nomatch');
                    injectBadge(linkEl, badgeState, result);
                })
                .catch(() => injectBadge(linkEl, 'error', null));
            });
        }

        // --- 5. Also watch for lazy-loaded photos (eBird paginates the grid) ---
        processSections();
        new MutationObserver(processSections).observe(document.body, { childList: true, subtree: true });
  })();
}

// other pages: do nothing