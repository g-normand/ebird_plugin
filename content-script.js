
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

    function checkUnderReview(img) {
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
            checkUnderReview(img);
        } else {
            img.addEventListener("load", () => checkUnderReview(img), { once: true });
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
        const coordsMatch = mapsLink?.href.match(
	  /query=(-?[\d.]+(?:[eE][+-]?\d+)?),(-?[\d.]+(?:[eE][+-]?\d+)?)/
	);
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
                softmatch: { bg: '#f57f17', text: '~ soft agree' },
                nomatch:   { bg: '#c62828', text: '✗' },
                disagree:   { bg: '#c62828', text: '✗' },
                error:     { bg: '#e65100', text: '! error' },
            }[state];

            let label = cfg.text;
            let tooltip = '';

            if (state === 'match' && data?.confidence != null) {
                label   = `✓ ${Math.round(data.confidence * 100)}%`;
                tooltip = `AI confidently agrees (${data.opinion})`;
            }
            else if (state === 'softmatch' && data?.confidence != null) {
                if (data.match){
                    label = `${Math.round(data.confidence * 100)}%`
                }
                else {
                    label   = `${data?.suggested} (${Math.round(data.confidence * 100)}%)`;
                }
                tooltip = `AI soft-agrees: ${data.suggested ?? '?'}` +
                        (data.confidence != null ? ` (${Math.round(data.confidence * 100)}%)` : '');
            }
            else if (state === 'disagree') {
                label   = `✗ ${data?.opinion ?? '?'} : ${data?.suggested} (${Math.round(data.confidence * 100)}%)`;
                tooltip = ``;
            }
            else if (state === 'nomatch') {
                label   = `✗ ${data?.opinion ?? '?'}`;
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
                        confident_disagree:      'disagree',
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

// ============================================================
// PAGE: /hotspot/[id] — altitude lookup
// ============================================================

if (/^\/hotspot\/L\d+$/.test(path)) {
    (async function addAltitude() {
        const placeLinks = document.querySelector('.PlaceLinks');
        if (!placeLinks) return;

        const mapsLink = placeLinks.querySelector('a[href*="maps/search/?api=1&query="]');
        if (!mapsLink) return;

        const coordsMatch = mapsLink.href.match(/query=(-?[\d.]+),(-?[\d.]+)/);
        if (!coordsMatch) {
            console.warn('[ebird-plugin] Could not find coordinates on hotspot page');
            return;
        }
        const lat = coordsMatch[1];
        const lng = coordsMatch[2];

        // placeholder badge while we wait on the request
        const badge = document.createElement('span');
        badge.className = 'ebird-altitude-badge';
        badge.textContent = ' … altitude';
        badge.style.marginLeft = '0.5rem';
        badge.style.fontWeight = 'bold';
        placeLinks.appendChild(badge);

        try {
	    const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`);
	    if (!res.ok) throw new Error(`HTTP ${res.status}`);
	    const data = await res.json();

	    const altitude = data?.elevation?.[0] ?? null;

	    if (altitude == null) {
		console.warn('[ebird-plugin] Could not parse altitude field from response', data);
		badge.textContent = ' ⛰ ?';
		badge.title = 'See console for raw response';
		return;
	    }

	    badge.textContent = ` ⛰ ${altitude} m`;
	    badge.title = 'Elevation via Open-Meteo';
	} catch (err) {
	    console.warn('[ebird-plugin] Elevation fetch failed:', err);
	    badge.textContent = ' ⛰ error';
	    badge.title = String(err);
	}
    })();
}

if (path.includes('/admin/hotspots.htm')) {
        document.querySelectorAll('tr').forEach(row => {
        const locInput = row.querySelector('input[name="locId"]');
        const countyCell = row.querySelector('td[headers="county"]');

        if (locInput && countyCell) {
            countyCell.innerHTML = '<a href="https://ebird.org/MyEBird?cmd=EditLoc&locID=' + locInput.value + '">Go to</a>' ;
        }
    });
}

// ============================================================
// PAGE: /tripreport/[id] — tag species with category from CSV
// ============================================================

if (/^\/tripreport\/\d+/.test(path)) {
    (function eBirdCategoryTagger() {

        // ---------- minimal CSV parser (handles quoted fields with commas/newlines) ----------
        function parseCSV(text) {
            const rows = [];
            let row = [];
            let field = '';
            let inQuotes = false;

            for (let i = 0; i < text.length; i++) {
                const c = text[i];
                const next = text[i + 1];

                if (inQuotes) {
                    if (c === '"' && next === '"') { field += '"'; i++; }
                    else if (c === '"') { inQuotes = false; }
                    else { field += c; }
                } else {
                    if (c === '"') { inQuotes = true; }
                    else if (c === ',') { row.push(field); field = ''; }
                    else if (c === '\r') { /* skip */ }
                    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
                    else { field += c; }
                }
            }
            if (field.length > 0 || row.length > 0) {
                row.push(field);
                rows.push(row);
            }
            return rows.filter(r => r.some(cell => cell !== ''));
        }

        function buildDictionary(csvText) {
            const dict = {};
            if (!csvText || !csvText.trim()) return dict;

            const rows = parseCSV(csvText);
            if (rows.length === 0) return dict;

            const header = rows[0].map(h => h.trim().toLowerCase());
            const nameIdx = header.indexOf('common name');
            const catIdx = header.indexOf('category');

            if (nameIdx === -1 || catIdx === -1) {
                console.warn('[ebird-plugin] tripreport: could not find "Common Name" / "Category" columns in CSV header.');
                return dict;
            }

            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                const name = (r[nameIdx] || '').trim();
                const cat = (r[catIdx] || '').trim();
                if (!name) continue;
                dict[name.toLowerCase()] = cat; // last occurrence wins
            }
            return dict;
        }

        // ---------- category definitions (colors, labels) shared by badges + filter chips ----------
        const CATEGORY_DEFS = {
            yes:         { label: 'Yes',         bg: '#2e7d32', fg: '#fff' },
            a_ameliorer: { label: 'A améliorer', bg: '#f9a825', fg: '#000' },
            no_photo:    { label: 'No photo',    bg: '#5c6bc0', fg: '#fff' },
            ec_missing:  { label: 'EC missing',  bg: '#c62828', fg: '#fff' },
            not_in_csv:  { label: 'Not in CSV',  bg: '#9e9e9e', fg: '#fff' },
        };
        const OTHER_DEF = { label: 'Other', bg: '#6d4c41', fg: '#fff' };
        const FILTER_KEYS = ['yes', 'a_ameliorer', 'no_photo', 'ec_missing', 'not_in_csv'];

        // Maps a raw CSV category value (or "not found") to one of the known keys above,
        // falling back to "other" for any value your CSV uses that isn't one of the 4 known ones.
        function normalizeCategoryKey(catRaw, found) {
            if (!found) return 'not_in_csv';
            const c = (catRaw || '').trim().toLowerCase();
            return Object.prototype.hasOwnProperty.call(CATEGORY_DEFS, c) ? c : 'other';
        }

        function categoryDef(key) {
            return CATEGORY_DEFS[key] || OTHER_DEF;
        }

        function makeBadge(key, rawValue) {
            const def = categoryDef(key);
            const label = key === 'other' ? (rawValue || '(blank)') : def.label;
            const badge = document.createElement('span');
            badge.className = 'ebird-cat-badge';
            badge.textContent = label;
            badge.style.cssText = `
                display:inline-block; margin-left:8px; padding:2px 8px;
                border-radius:12px; font-size:11px; font-weight:600; line-height:1.6;
                vertical-align:middle; background:${def.bg}; color:${def.fg}; white-space:nowrap;
            `;
            return badge;
        }

        // ---------- filtering ----------
        const hiddenCategories = new Set(); // keys currently hidden; empty = show everything

        function applyRowVisibility(li) {
            const key = li.dataset.ebirdCategory;
            li.style.display = hiddenCategories.has(key) ? 'none' : '';
        }

        function tagSpeciesRow(li, dict) {
            if (li.dataset.ebirdTagged === '1') return;

            const nameSpan = li.querySelector('.Species-common');
            if (!nameSpan) return;

            const commonName = nameSpan.textContent.trim();
            const lookupKey = commonName.toLowerCase();
            const nameHeading = li.querySelector('.ReportListSpecies-name h3.Heading') || nameSpan.parentElement;

            const found = Object.prototype.hasOwnProperty.call(dict, lookupKey);
            const rawValue = found ? dict[lookupKey] : null;
            const categoryKey = normalizeCategoryKey(rawValue, found);

            nameHeading.appendChild(makeBadge(categoryKey, rawValue));
            li.dataset.ebirdCategory = categoryKey;
            applyRowVisibility(li);

            li.dataset.ebirdTagged = '1';
        }

        function tagAll(dict) {
            document.querySelectorAll('li.ReportListSpecies').forEach(li => tagSpeciesRow(li, dict));
        }

        function retagAll(dict) {
            document.querySelectorAll('li.ReportListSpecies').forEach(li => {
                li.dataset.ebirdTagged = '';
                li.querySelectorAll('.ebird-cat-badge').forEach(b => b.remove());
            });
            tagAll(dict);
        }

        // ---------- inline "Load CSV" button next to the report title's visibility badge ----------
        function countSpecies(dict) {
            return Object.keys(dict).length;
        }

        function insertUploadButton(dict) {
            if (document.getElementById('ebird-cat-upload-wrapper')) {
                updateUploadButtonLabel(countSpecies(dict));
                return;
            }

            const privacyDiv = document.querySelector('.ReportTitle-privacy');
            if (!privacyDiv) return;

            const wrapper = document.createElement('span');
            wrapper.id = 'ebird-cat-upload-wrapper';
            wrapper.style.cssText = 'margin-left:10px; display:inline-flex; align-items:center; gap:6px;';

            const btn = document.createElement('button');
            btn.id = 'ebird-cat-upload-btn';
            btn.type = 'button';
            btn.style.cssText = `
                font-size:11px; padding:3px 10px; cursor:pointer;
                border:1px solid #ccc; border-radius:4px; background:#fff;
            `;

            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.accept = '.csv,text/csv';
            fileInput.style.display = 'none';

            btn.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                    chrome.storage.local.set({ ebirdCategoryCsv: reader.result });
                    // storage.onChanged listener below handles re-tagging + label update
                };
                reader.readAsText(file);
            });

            wrapper.appendChild(btn);
            wrapper.appendChild(fileInput);
            privacyDiv.insertAdjacentElement('afterend', wrapper);

            updateUploadButtonLabel(countSpecies(dict));
        }

        function updateUploadButtonLabel(count) {
            const btn = document.getElementById('ebird-cat-upload-btn');
            if (!btn) return;
            const label = count > 0 ? `CSV loaded (${count}) — Reload` : 'Load CSV';
            // IMPORTANT: only write if the label actually changes. Setting textContent
            // unconditionally would re-trigger the MutationObserver below on every call,
            // which calls this function again → infinite loop → page appears to hang.
            if (btn.textContent !== label) {
                btn.textContent = label;
            }
        }

        // ---------- filter chip row: toggle visibility per category ----------
        function styleChip(chip, key, active) {
            const def = categoryDef(key);
            chip.style.cssText = `
                font-size:11px; padding:3px 10px; cursor:pointer; border-radius:12px;
                border:1px solid ${def.bg};
                background:${active ? def.bg : '#fff'};
                color:${active ? def.fg : def.bg};
                opacity:${active ? '1' : '0.55'};
                text-decoration:${active ? 'none' : 'line-through'};
                white-space:nowrap;
            `;
        }

        function insertFilterPanel() {
            if (document.getElementById('ebird-cat-filter-wrapper')) return;

            const liferDiv = document.querySelector('.StatsTabs');
            if (!liferDiv) return;

            const filterWrapper = document.createElement('div');
            filterWrapper.id = 'ebird-cat-filter-wrapper';
            filterWrapper.style.cssText = 'margin-top:6px; display:flex; flex-wrap:wrap; gap:6px; align-items:center;';

            FILTER_KEYS.forEach((key) => {
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'ebird-cat-filter-chip';
                chip.dataset.categoryKey = key;
                chip.textContent = categoryDef(key).label;
                styleChip(chip, key, true); // all visible by default

                chip.addEventListener('click', () => {
                    const nowHidden = !hiddenCategories.has(key);
                    if (nowHidden) hiddenCategories.add(key);
                    else hiddenCategories.delete(key);

                    styleChip(chip, key, !nowHidden);
                    document
                        .querySelectorAll(`li.ReportListSpecies[data-ebird-category="${key}"]`)
                        .forEach(applyRowVisibility);

                    var nbSpecies = Array.from(document.querySelectorAll('.ReportListSpecies'))
                    .filter(el => el.offsetParent !== null)
                    .length;
                    document.getElementById('cat-info').textContent = nbSpecies + ' species';
                });                
                filterWrapper.appendChild(chip);
            });

            const info = document.createElement('span');
            info.id = 'cat-info';

            filterWrapper.appendChild(info);
            liferDiv.insertAdjacentElement('afterend', filterWrapper);
        }

        // ---------- load CSV from extension storage, tag page, watch for changes ----------
        chrome.storage.local.get('ebirdCategoryCsv', (result) => {
            const dict = buildDictionary(result.ebirdCategoryCsv || '');
            tagAll(dict);
            insertUploadButton(dict);
            insertFilterPanel();

            // eBird lazily renders/paginates species rows and the title bar on some trip reports
            const observer = new MutationObserver(() => {
                tagAll(dict);
                insertUploadButton(dict);
                insertFilterPanel();
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });

        // Live-update badges + button label if the CSV is (re)loaded while this tab is open
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.ebirdCategoryCsv) {
                const dict = buildDictionary(changes.ebirdCategoryCsv.newValue || '');
                retagAll(dict);
                updateUploadButtonLabel(countSpecies(dict));
                insertFilterPanel();
                alert('CSV loaded');
            }
        });
    })();
}


// ============================================================
// PAGE: /species/[] — add a small HTML link
// ============================================================

if (/^\/species\/\w+/.test(path)) {
   
    var scientificName = document.querySelector('.Heading-sub--sci').textContent;

    const wrapper = document.createElement('button');
    wrapper.id = 'usherbrooke-link';

    const nfomLink = document.createElement('a');
    nfomLink.href = `https://nfom.recherche.usherbrooke.ca/rechercher?s=${scientificName}`;
    nfomLink.textContent = 'Lien NFOM';
    nfomLink.target = '_blank';
    nfomLink.style = 'color:cadetblue;';

    var badges = document.querySelector('.ActivityBadge').insertAdjacentElement('afterend', nfomLink);
}
// other pages: do nothing
