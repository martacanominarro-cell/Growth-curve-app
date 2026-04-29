const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const uploadBtn = document.getElementById('upload-btn');
const uploadStatus = document.getElementById('upload-status');
const plateGrid = document.getElementById('plate-grid');
const analyzeBtn = document.getElementById('analyze-btn');
const analyzeStatus = document.getElementById('analyze-status');
const resultsSection = document.getElementById('results-section');
const mappedListBox = document.getElementById('mapped-list');
const qcSection = document.getElementById('qc-section');
const qcPlots = document.getElementById('qc-plots');

let uploadedFiles = [];
let rawDataCache = null;
let layoutMap = {};
let selectedWells = new Set();
let latestResults = null;
let currentShuffledPalette = null; // New state to hold shuffled colors consistently

const BACKEND_URL = '';

// Initialize Grid
const rows = ['A','B','C','D','E','F','G','H'];
let isDragging = false;
let isSelecting = true;

document.addEventListener('mouseup', () => { isDragging = false; });

function toggleWell(el, wellId, select) {
    if(select) {
        selectedWells.add(wellId);
        el.classList.add('selected');
    } else {
        selectedWells.delete(wellId);
        el.classList.remove('selected');
    }
}

rows.forEach(r => {
    for(let c=1; c<=12; c++) {
        const wellId = `${r}${c}`;
        const div = document.createElement('div');
        div.className = 'well';
        div.innerText = wellId;
        div.dataset.well = wellId;
        
        div.addEventListener('mousedown', (e) => {
            isDragging = true;
            isSelecting = !selectedWells.has(wellId);
            toggleWell(div, wellId, isSelecting);
        });
        
        div.addEventListener('mouseenter', (e) => {
            if(isDragging) {
                toggleWell(div, wellId, isSelecting);
            }
        });
        
        plateGrid.appendChild(div);
    }
});

// File Handling
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => dropZone.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }));
dropZone.addEventListener('dragover', () => dropZone.classList.add('dragover'));
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => handleFiles(fileInput.files));

function handleFiles(files) {
    for(let f of files) uploadedFiles.push(f);
    fileList.innerHTML = uploadedFiles.map(f => `<div>✅ ${f.name}</div>`).join('');
    uploadBtn.disabled = uploadedFiles.length === 0;
}

// Upload Data
uploadBtn.addEventListener('click', async () => {
    uploadStatus.innerText = 'Uploading and processing files...';
    uploadBtn.disabled = true;
    const formData = new FormData();
    uploadedFiles.forEach(f => formData.append('files', f));
    
    try {
        const res = await fetch(`${BACKEND_URL}/upload`, { method: 'POST', body: formData });
        if(!res.ok) throw new Error(await res.text());
        const data = await res.json();
        rawDataCache = data.raw_data;
        uploadStatus.style.color = 'var(--success)';
        uploadStatus.innerText = `Data loaded! Rows: ${rawDataCache.length}`;
        
        // Immediately trigger 96-well visual layout prior to mapping assignments!
        document.getElementById('pre-mapping-container').style.display = 'block';
        
        const fileNames = [...new Set(rawDataCache.map(r => r.File))];
        const fileSelect = document.getElementById('pre-mapping-file');
        fileSelect.innerHTML = `<option value="">Average All Plates</option>` + fileNames.map(f => `<option value="${f}">${f}</option>`).join('');
        
        renderPreMappingGrid(rawDataCache);

    } catch (e) {
        uploadStatus.style.color = 'var(--danger)';
        uploadStatus.innerText = e.message;
    }
    uploadBtn.disabled = false;
});

function updateMappedList() {
    const counts = {};
    Object.values(layoutMap).forEach(v => {
        const key = `${v.Strain} | ${v.Condition}`;
        counts[key] = (counts[key] || 0) + 1;
    });
    
    const keys = Object.keys(counts);
    if(keys.length === 0) {
        mappedListBox.innerHTML = '<p class="empty-text">No wells mapped yet.</p>';
        return;
    }
    mappedListBox.innerHTML = keys.map(k => `<div class="mapped-item"><span>${k}</span>: ${counts[k]} well(s)</div>`).join('');
}

// Mapping Logic
document.getElementById('apply-map-btn').addEventListener('click', () => {
    const strain = document.getElementById('strain-input').value.trim();
    const cond = document.getElementById('condition-input').value.trim();
    if(!strain || !cond) return alert("Enter Strain and Condition!");
    if(selectedWells.size === 0) return alert("Select wells first!");
    
    selectedWells.forEach(w => {
        layoutMap[w] = { Strain: strain, Condition: cond };
        const el = document.querySelector(`.well[data-well="${w}"]`);
        el.className = 'well mapped';
        el.title = `${strain} - ${cond}`;
    });
    selectedWells.clear();
    updateMappedList();
});

document.getElementById('clear-sel-btn').addEventListener('click', () => {
    selectedWells.forEach(w => {
        const el = document.querySelector(`.well[data-well="${w}"]`);
        if(!layoutMap[w]) el.className = 'well';
        else el.className = 'well mapped';
    });
    selectedWells.clear();
});

document.getElementById('clear-map-btn').addEventListener('click', () => {
    layoutMap = {};
    selectedWells.clear();
    document.querySelectorAll('.well').forEach(el => { el.className = 'well'; el.title = ''; });
    updateMappedList();
});

// Run Analysis
analyzeBtn.addEventListener('click', async () => {
    if(!rawDataCache) return alert("Upload data first!");
    if(Object.keys(layoutMap).length === 0) return alert("Map plate layout first!");
    
    analyzeStatus.innerText = 'Extracting parameters... (this takes a few seconds)';
    analyzeStatus.style.color = 'var(--text-muted)';
    analyzeBtn.disabled = true;
    
    try {
        const payload = { raw_data: rawDataCache, layout_map: layoutMap };
        const res = await fetch(`${BACKEND_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if(!res.ok) throw new Error(await res.text());
        latestResults = await res.json();
        
        // Load selected palette
        currentShuffledPalette = getThemeColors();
        
        // Populate Baseline Dropdown
        const groups = [...new Set(latestResults.parameters.map(p => `${p.Strain} | ${p.Condition}`))];
        document.getElementById('baseline-select').innerHTML = '<option value="">None</option>' + groups.map(g => `<option value="${g}">${g}</option>`).join('');
        
        qcSection.classList.remove('hidden');
        renderQCPlots(latestResults.qc_data);
        
        renderResults(true); // true = force render all
        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({behavior: 'smooth'});
        analyzeStatus.innerText = 'Analysis complete!';
        analyzeStatus.style.color = 'var(--success)';
        
    } catch (e) {
        analyzeStatus.style.color = 'var(--danger)';
        analyzeStatus.innerText = e.message;
    }
    analyzeBtn.disabled = false;
});

// Settings Handlers
document.getElementById('apply-formatting').addEventListener('click', () => {
    if(latestResults) renderResults(false);
});
document.getElementById('apply-all-formatting').addEventListener('click', () => {
    if(latestResults) renderResults(true);
});
document.getElementById('heatmap-metric').addEventListener('change', () => {
    if(latestResults) renderHeatmap();
});
document.getElementById('pre-mapping-metric').addEventListener('change', () => {
    if(rawDataCache) renderPreMappingGrid(rawDataCache);
});
document.getElementById('pre-mapping-file').addEventListener('change', () => {
    if(rawDataCache) renderPreMappingGrid(rawDataCache);
});
document.getElementById('zero-outliers-chk').addEventListener('change', () => {
    if(latestResults) renderResults(true);
});
const THEMES = {
    custom: { name: 'Custom Base (Seaborn)', palette: ['#f59700', '#a058d8', '#df582c', '#8a1100', '#6a86ff', '#9fcafb', '#e01e5a'] },
    access: { name: 'Maximum Contrast (Accessible)', palette: ['#e6194B', '#3cb44b', '#4363d8', '#ffe119', '#f58231', '#911eb4', '#42d4f4'] },
    cyber: { name: 'Neon Cyberpunk (Dark/Light)', palette: ['#FF007F', '#00F0FF', '#FFE600', '#00FF00', '#9D00FF', '#FF4E00', '#0084FF'] },
    spring: { name: 'Spring Brights', palette: ['#ff6b6b', '#1a535c', '#ffe66d', '#4ecdc4', '#ff9f1c', '#2ec4b6', '#ff0054'] },
    pastel: { name: 'Soft Pastels', palette: ['#ffb3ba', '#bae1ff', '#baffc9', '#ffffba', '#ffdfba', '#e6c8fa', '#c4faf8'] },
    publication: { name: 'Publication (Grey/Blue)', palette: ['#111111', '#2c7fb8', '#7fcdbb', '#555555', '#edf8b1', '#bdbdbd', '#636363'] }
};

// Initialize Custom Select
const themeWidget = document.getElementById('theme-widget');
const themeActive = document.getElementById('theme-active');
const themeList = document.getElementById('theme-list');
const themeText = document.getElementById('theme-active-text');
const themeSwatches = document.getElementById('theme-active-swatches');

function buildSwatches(palette) {
    return palette.slice(0, 6).map(c => `<div class="swatch" style="background:${c}"></div>`).join('');
}

// Build dropdown html
themeList.innerHTML = Object.entries(THEMES).map(([key, data]) => `
    <div class="color-option" data-key="${key}">
        <span>${data.name}</span>
        <div class="swatch-bin">${buildSwatches(data.palette)}</div>
    </div>
`).join('');

themeActive.addEventListener('click', (e) => {
    themeList.classList.toggle('show');
    e.stopPropagation();
});

document.addEventListener('click', () => themeList.classList.remove('show'));

document.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', (e) => {
        const key = e.currentTarget.getAttribute('data-key');
        themeWidget.setAttribute('data-value', key);
        themeText.innerText = THEMES[key].name;
        themeSwatches.innerHTML = buildSwatches(THEMES[key].palette);
        
        currentShuffledPalette = THEMES[key].palette;
        if(latestResults) {
            renderResults(false);
            renderHeatmap();
        }
        if(rawDataCache) {
            renderPreMappingGrid(rawDataCache);
        }
    });
});
// Set initial swatches
themeSwatches.innerHTML = buildSwatches(THEMES['custom'].palette);

function getThemeColors() {
    const key = themeWidget.getAttribute('data-value');
    return THEMES[key]?.palette || THEMES['custom'].palette;
}

function renderQCPlots(qcData) {
    qcPlots.innerHTML = '';
    if(!qcData) return;
    
    const colors = getThemeColors();
    
    Object.keys(qcData).forEach((group, idx) => {
        const divId = 'qc-' + idx;
        const box = document.createElement('div');
        box.id = divId;
        box.className = 'chart-box';
        qcPlots.appendChild(box);
        
        const traces = [];
        qcData[group].forEach((trace, ti) => {
            traces.push({
                x: trace.time, y: trace.od, 
                name: `${trace.file} (${trace.well})`, 
                type: 'scatter', mode: 'lines+markers',
                line: { width: 1.5 }, marker: {size: 4}
            });
        });
        
        Plotly.newPlot(divId, traces, {
            title: `QC: ${group}`, height: 350, margin: {t:40,b:40,l:40,r:10},
            xaxis: {title: 'Time (Hours)'}, yaxis: {title: 'OD'}
        });
    });
}

function renderResults(forceAllTargets) {
    const data = latestResults;
    if(!data) return;
    
    // Parse formatting inputs
    const fontFamily = document.getElementById('font-family').value;
    const fontSize = parseInt(document.getElementById('font-size').value) || 14;
    const lineSize = parseInt(document.getElementById('line-size').value) || 2;
    // Sync active palette cleanly without shuffling
    currentShuffledPalette = getThemeColors();
    const colors = currentShuffledPalette;
    
    const plotTitle = document.getElementById('plot-title').value.trim() || 'Averaged Growth Curves';
    const xAxisTitle = document.getElementById('xaxis-title').value.trim() || 'Time (Hours)';
    const yAxisTitle = document.getElementById('yaxis-title').value.trim() || 'Optical Density';
    const yAxisScale = document.getElementById('yaxis-scale').value;
    
    const customWidth = document.getElementById('plot-width').value;
    const customHeight = document.getElementById('plot-height').value;
    const barGap = parseFloat(document.getElementById('bar-gap').value) || 0.3;
    
    const xtick = document.getElementById('xtick-dtick').value;
    const ytick = document.getElementById('ytick-dtick').value;
    
    // Determine active targets
    let activeTargets = [];
    if(forceAllTargets) {
        activeTargets = ['curve-chart', 'k-chart', 'r-chart', 'lambda-chart', 'auc-chart'];
    } else {
        document.querySelectorAll('.target-chk').forEach(chk => {
            if(chk.checked) activeTargets.push(chk.value);
        });
    }
    
    // Global Config
    const layoutConfig = {
        font: { family: fontFamily, size: fontSize },
        plot_bgcolor: "white", paper_bgcolor: "white",
        xaxis: { showline: true, linewidth: 2, linecolor: 'black', mirror: true, ticks: 'outside' },
        yaxis: { showline: true, linewidth: 2, linecolor: 'black', mirror: true, ticks: 'outside' },
        margin: { t: 80, b: 110, l: 60, r: 20 },
        autosize: false,
        height: customHeight ? parseInt(customHeight) : 450
    };
    
    // Tick Customization
    if(xtick) { layoutConfig.xaxis.dtick = parseFloat(xtick); layoutConfig.xaxis.tick0 = 0; }
    if(ytick) { layoutConfig.yaxis.dtick = parseFloat(ytick); layoutConfig.yaxis.tick0 = 0; }

    const plotOptions = {
        responsive: true,
        toImageButtonOptions: { format: 'svg', filename: 'plot_export', height: parseInt(customHeight)||600, width: parseInt(customWidth)||800, scale: 1 }
    };

    // Stat logic
    const smap = data.statistics || {};
    document.getElementById('stat-results').innerHTML = `
        <div class="stat-item">K p-value: <span>${smap?.K?.p_val?.toExponential(3) || 'N/A'}</span></div>
        <div class="stat-item">r p-value: <span>${smap?.r?.p_val?.toExponential(3) || 'N/A'}</span></div>
        <div class="stat-item">\u03bb p-value: <span>${smap?.['lambda']?.p_val?.toExponential(3) || 'N/A'}</span></div>
        <div class="stat-item">AUC p-value: <span>${smap?.auc?.p_val?.toExponential(3) || 'N/A'}</span></div>
    `;
    
    // Bar Logic
    const params = data.parameters;
    const groups = [...new Set(params.map(p => `${p.Strain} | ${p.Condition}`))];
    
    const plotBar = (divId, metric, title) => {
        if(!activeTargets.includes(divId)) return;
        const x = [], y = [], error = [];
        const markerColors = [];
        const baseline = document.getElementById('baseline-select').value;
        const annotations = [];
        
        groups.forEach((g, idx) => {
            const rawVals = params.filter(p => `${p.Strain} | ${p.Condition}` === g).map(p => p[metric]);
            const treatAsZero = document.getElementById('zero-outliers-chk') ? document.getElementById('zero-outliers-chk').checked : false;
            const vals = treatAsZero ? rawVals.map(v => v === null ? 0 : v) : rawVals.filter(v => v !== null);
            
            if(vals.length === 0) return; // Skip if no valid data
            
            const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
            const pdiff = vals.map(x => Math.pow(x - mean, 2)).reduce((a,b)=>a+b,0);
            const sd = vals.length > 1 ? Math.sqrt(pdiff/(vals.length - 1)) : 0;
            
            x.push(g); y.push(mean || 0); error.push(sd || 0);
            markerColors.push(colors[idx % colors.length]);
            
            // Generate stat annotations
            if(baseline && baseline !== g && data.pairwise_stats && data.pairwise_stats[metric] && data.pairwise_stats[metric][baseline]) {
                const pval = data.pairwise_stats[metric][baseline][g];
                if(pval !== undefined) {
                    let sig = 'ns';
                    if(pval < 0.001) sig = '***';
                    else if(pval < 0.01) sig = '**';
                    else if(pval < 0.05) sig = '*';
                    
                    annotations.push({
                        x: g, y: (mean || 0) + (sd || 0),
                        text: sig, showarrow: false, font: {size: Math.max(16, fontSize), weight: 'bold', color: 'black'},
                        yshift: 10, yanchor: 'bottom'
                    });
                }
            }
        });
        
        Plotly.newPlot(divId, [{
            x, y, type: 'bar', marker: { color: markerColors, line: {color: '#000', width: 1.5} },
            error_y: { type: 'data', array: error, visible: true, color: '#000', thickness: lineSize }
        }], { ...layoutConfig, title: { text: title, font: {weight: 'bold'} }, bargap: barGap, annotations: annotations, width: 300 }, plotOptions);
    };
    
    plotBar('k-chart', 'K', 'Carrying Capacity (K)');
    plotBar('r-chart', 'r', 'Growth Rate (r)');
    plotBar('lambda-chart', 'lambda', 'Lag Time (\u03bb)');
    plotBar('auc-chart', 'auc', 'Area Under Curve (AUC)');
    
    // Curve Logic
    if(data.curves && activeTargets.includes('curve-chart')) {
        const traces = []; let cIdx = 0;
        Object.keys(data.curves).forEach(g => {
            const c = data.curves[g];
            traces.push({
                x: c.time, y: c.mean, name: g, type: 'scatter', mode: 'lines+markers',
                line: { width: lineSize, color: colors[cIdx % colors.length] }, marker: { size: Math.max(lineSize * 2, 4) },
                error_y: { type: 'data', array: c.sd, visible: true, thickness: lineSize, color: colors[cIdx % colors.length] }
            });
            cIdx++;
        });
        const curveLayout = { 
            ...layoutConfig, title: {text: plotTitle, font: {weight: 'bold'}},
            xaxis: {...layoutConfig.xaxis, title: xAxisTitle}, 
            yaxis: {...layoutConfig.yaxis, title: yAxisTitle, type: yAxisScale},
            width: customWidth ? parseInt(customWidth) : 800
        };
        Plotly.newPlot('curve-chart', traces, curveLayout, plotOptions);
    }
    
    renderHeatmap();
    renderBubblePlot(data);
}

function renderHeatmap() {
    if(!latestResults) return;
    const metric = document.getElementById('heatmap-metric').value;
    
    if (metric === 'curves') return; // Deprecated -> Shifted natively to Pre-Mapping Layout.
    
    if(!latestResults.parameters) return;
    
    // Group identically mapped wells from different files and average them
    const wellMap = {};
    latestResults.parameters.forEach(p => {
        if(!wellMap[p.Well]) wellMap[p.Well] = [];
        wellMap[p.Well].push(p[metric]);
    });
    
    const rows = ['A','B','C','D','E','F','G','H'];
    const cols = [1,2,3,4,5,6,7,8,9,10,11,12];
    const theme = document.getElementById('theme-widget').getAttribute('data-value');
    
    const xData = [];
    const yData = [];
    const sizeData = [];
    const colorData = [];
    const textData = [];
    
    rows.forEach(r => {
        cols.forEach(c => {
            const well = `${r}${c}`;
            if(wellMap[well] && wellMap[well].length > 0) {
                const rawVals = wellMap[well];
                const treatAsZero = document.getElementById('zero-outliers-chk') ? document.getElementById('zero-outliers-chk').checked : false;
                const vals = treatAsZero ? rawVals.map(v => v === null ? 0 : v) : rawVals.filter(v => v !== null);
                
                if (vals.length > 0) {
                    const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
                    const sd = vals.length > 1 ? Math.sqrt(vals.map(v => Math.pow(v - mean, 2)).reduce((a,b)=>a+b,0)/(vals.length - 1)) : 0;
                    
                    xData.push(c);
                    yData.push(r);
                    colorData.push(mean);
                    sizeData.push(sd);
                    textData.push(`Well: ${well}<br>Avg: ${mean.toFixed(3)}<br>SD: ${sd.toFixed(3)}<br>Replicates: ${vals.length}`);
                }
            }
        });
    });
    
    let colorscale = 'Viridis';
    if(theme === 'cyber') colorscale = 'Plasma';
    if(theme === 'publication') colorscale = 'Greys';
    if(theme === 'access') colorscale = 'Portland';
    if(theme === 'spring') colorscale = 'Picnic';
    if(theme === 'pastel') colorscale = 'Pastel';

    const maxSd = Math.max(...sizeData, 0.0001);
    const scaledSizes = sizeData.map(sd => 15 + (sd / maxSd) * 25);

    const trace = {
        x: xData, y: yData, mode: 'markers', text: textData, hoverinfo: 'text',
        marker: {
            size: scaledSizes,
            color: colorData,
            colorscale: colorscale,
            showscale: true,
            line: { color: 'rgba(0,0,0,0.5)', width: 1 }
        }
    };


    const heatmapLayout = {
         title: { text: `96-Well Bubble Plot: Average ${metric} (Size = Error)`, font: {weight: 'bold'} },
         xaxis: { title: 'Column', tickmode: 'array', tickvals: cols, side: 'top', showgrid: false },
         yaxis: { title: 'Row', autorange: 'reversed', tickmode: 'array', tickvals: rows, showgrid: false },
         plot_bgcolor: "#ffffff", paper_bgcolor: "#ffffff",
         height: 500, margin: {t: 80, b:40, l:60, r:20}
    };

    Plotly.newPlot('heatmap-chart', [trace], heatmapLayout, {responsive: true});
}


document.getElementById('download-csv').addEventListener('click', () => {
    if(!latestResults || !latestResults.parameters) return alert("No parameters extracted yet!");
    const ws = XLSX.utils.json_to_sheet(latestResults.parameters);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Parameters");
    XLSX.writeFile(wb, "Growth_Parameters_Export.xlsx");
});

document.getElementById('download-prism').addEventListener('click', () => {
    if(!latestResults || !latestResults.parameters) return alert("No parameters extracted yet!");
    const wb = XLSX.utils.book_new();
    const params = latestResults.parameters;
    
    // Group identically mapped wells (blinding replicates for Prism alignment)
    const metrics = ['K', 'r', 'lambda', 'auc'];
    metrics.forEach(metric => {
        const pivotData = {};
        let maxReplicates = 0;
        
        params.forEach(p => {
            const groupName = `${p.Strain} | ${p.Condition}`;
            if(!pivotData[groupName]) pivotData[groupName] = [];
            pivotData[groupName].push(p[metric]);
            if(pivotData[groupName].length > maxReplicates) maxReplicates = pivotData[groupName].length;
        });
        
        const groups = Object.keys(pivotData);
        if(groups.length === 0) return;
        
        const sheetRows = [groups]; // Row 0 is the Group Headers
        for(let i=0; i<maxReplicates; i++) {
            const row = [];
            groups.forEach(g => {
                row.push(pivotData[g][i] !== undefined ? pivotData[g][i] : null);
            });
            sheetRows.push(row);
        }
        
        const ws = XLSX.utils.aoa_to_sheet(sheetRows);
        XLSX.utils.book_append_sheet(wb, ws, metric);
    });
    
    XLSX.writeFile(wb, "Growth_Prism_Format_Export.xlsx");
});

function renderPreMappingGrid(dataArray) {
    if(!dataArray || dataArray.length === 0) return;
    
    const selectedFile = document.getElementById('pre-mapping-file') ? document.getElementById('pre-mapping-file').value : "";
    const filteredData = selectedFile ? dataArray.filter(r => r.File === selectedFile) : dataArray;

    // Group flat records into individual trace arrays
    const groupedData = {};
    filteredData.forEach(row => {
        const key = `${row.File}|${row.Well}`;
        if (!groupedData[key]) {
            groupedData[key] = { File: row.File, Well: row.Well, Time_hours: [], OD: [], K: row.K, r: row.r, lambda: row.lambda, auc: row.auc };
        }
        groupedData[key].Time_hours.push(row.Time_hours);
        groupedData[key].OD.push(row.OD);
    });
    const traceArray = Object.values(groupedData);
    
    const metric = document.getElementById('pre-mapping-metric').value;
    const theme = document.getElementById('theme-widget').getAttribute('data-value');
    const rows = ['A','B','C','D','E','F','G','H'];
    const cols = [1,2,3,4,5,6,7,8,9,10,11,12];

    if (metric !== 'curves') {
        const xData = [];
        const yData = [];
        const sizeData = [];
        const colorData = [];
        const textData = [];
        
        rows.forEach(r => {
            cols.forEach(c => {
                const well = `${r}${c}`;
                const wellItems = traceArray.filter(item => item.Well === well);
                
                if (wellItems.length > 0) {
                    const rawVals = wellItems.map(item => item[metric]);
                    const treatAsZero = document.getElementById('zero-outliers-chk') ? document.getElementById('zero-outliers-chk').checked : false;
                    const vals = treatAsZero ? rawVals.map(v => v === null ? 0 : v) : rawVals.filter(v => v !== null);
                    
                    if (vals.length > 0) {
                        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
                        const sd = vals.length > 1 ? Math.sqrt(vals.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / (vals.length - 1)) : 0;
                        
                        xData.push(c);
                        yData.push(r);
                        colorData.push(mean);
                        sizeData.push(sd);
                        textData.push(`Well: ${well}<br>Avg ${metric.toUpperCase()}: ${mean.toFixed(3)}<br>SD: ${sd.toFixed(3)}<br>Replicates: ${vals.length}`);
                    }
                }
            });
        });

        const maxSd = Math.max(...sizeData, 0.0001);
        const scaledSizes = sizeData.map(sd => 15 + (sd / maxSd) * 25);

        let colorscale = 'Viridis';
        if(theme === 'cyber') colorscale = 'Plasma';
        if(theme === 'publication') colorscale = 'Greys';
        if(theme === 'access') colorscale = 'Portland';
        if(theme === 'spring') colorscale = 'Picnic';
        if(theme === 'pastel') colorscale = 'Pastel';

        const trace = {
            x: xData, y: yData, mode: 'markers', text: textData, hoverinfo: 'text',
            marker: {
                size: scaledSizes, color: colorData, colorscale: colorscale, showscale: true,
                line: { color: 'rgba(0,0,0,0.5)', width: 1 }
            }
        };

        const heatmapLayout = {
             title: { text: `Pre-Computed ${metric.toUpperCase()} Bubble Plot (All Plates)`, font: {weight: 'bold'}, color: '#333' },
             xaxis: { title: 'Column', tickmode: 'array', tickvals: cols, side: 'top', showgrid: false },
             yaxis: { title: 'Row', autorange: 'reversed', tickmode: 'array', tickvals: rows, showgrid: false },
             plot_bgcolor: "#ffffff", paper_bgcolor: "#ffffff",
             height: 500, margin: {t: 80, b:40, l:60, r:20}
        };

        Plotly.newPlot('pre-mapping-grid', [trace], heatmapLayout, {responsive: true});
        return;
    }

    
    // Compute exact global maximums so we can hardcode identically sized subplot limits
    let maxTime = 0;
    let maxOD = 0;
    traceArray.forEach(d => {
        const localMaxT = Math.max(...d.Time_hours);
        const localMaxOD = Math.max(...d.OD);
        if(localMaxT > maxTime) maxTime = localMaxT;
        if(localMaxOD > maxOD) maxOD = localMaxOD;
    });

    const traces = [];
    const layout = {
        title: { text: `Raw 96-Well Biological Replicates`, font: {weight: 'bold'}, y: 0.98, color: '#333' },
        grid: { rows: 8, columns: 12, pattern: 'independent', xgap: 0.05, ygap: 0.05 },
        height: 700, margin: {t: 60, b:40, l:60, r:20},
        plot_bgcolor: "#ffffff", paper_bgcolor: "#ffffff",
        showlegend: true, legend: {orientation: 'h', y: 1.05, x: 1, xanchor: 'right', yanchor: 'bottom', font: {color: '#333'}},
        font: {color: '#333'}
    };
    
    const uniqueFiles = [...new Set(traceArray.map(o => o.File))].sort();
    const legendAdded = new Set();
    const currentThemePalette = getThemeColors();
    
    let subIndex = 1;
    rows.forEach(r => {
        cols.forEach(c => {
            const well = `${r}${c}`;
            const suffix = subIndex === 1 ? '' : subIndex;
            const axisStr = suffix;
            
            const isBottom = r === 'H';
            const isLeft = c === 1;
            
            // Hardcode ranges linearly across everything. Crash proof!
            layout[`xaxis${axisStr}`] = { 
                showticklabels: isBottom, range: [0, maxTime], showgrid: false,
                showline: true, linewidth: 1, linecolor: 'rgba(0,0,0,0.5)', mirror: true, zeroline: false
            };
            layout[`yaxis${axisStr}`] = { 
                showticklabels: isLeft, range: [0, maxOD * 1.1], showgrid: false,
                showline: true, linewidth: 1, linecolor: 'rgba(0,0,0,0.5)', mirror: true, zeroline: false
            };
            
            if(c === 1) layout[`yaxis${axisStr}`].title = {text: r, font:{size:11, weight:'bold'}};
            if(r === 'A') layout[`xaxis${axisStr}`].title = {text: String(c), font:{size:11, weight:'bold'}, side: 'top'};
            
            const wellItems = traceArray.filter(item => item.Well === well);
            if (wellItems.length > 0) {
                wellItems.forEach(td => {
                    const fIdx = uniqueFiles.indexOf(td.File);
                    const showInLegend = !legendAdded.has(td.File);
                    if (showInLegend) legendAdded.add(td.File);
                    
                    traces.push({
                        x: td.Time_hours, y: td.OD, mode: 'lines',
                        xaxis: `x${suffix}`, yaxis: `y${suffix}`, name: td.File, showlegend: showInLegend,
                        line: {color: currentThemePalette[fIdx % currentThemePalette.length], width: 1.5}, hoverinfo: 'none'
                    });
                });
            } else {
                traces.push({ x: [], y: [], xaxis: `x${suffix}`, yaxis: `y${suffix}` });
            }
            subIndex++;
        });
    });
    
    Plotly.newPlot('pre-mapping-grid', traces, layout, {responsive: true});
}

function renderBubblePlot(data) {
    if(!data || !data.parameters) return;
    const metric = document.getElementById('heatmap-metric').value;
    const treatAsZero = document.getElementById('zero-outliers-chk') ? document.getElementById('zero-outliers-chk').checked : false;
    
    // Grouping by Strain and Condition for multi-plate averages
    const strains = [...new Set(data.parameters.map(p => p.Strain))].sort();
    const conditions = [...new Set(data.parameters.map(p => p.Condition))].sort();
    
    const x = [], y = [], size = [], color = [], text = [];

    strains.forEach(s => {
        conditions.forEach(c => {
            const matches = data.parameters.filter(p => p.Strain === s && p.Condition === c);
            if (matches.length > 0) {
                const rawVals = matches.map(m => m[metric]);
                const vals = treatAsZero ? rawVals.map(v => v === null ? 0 : v) : rawVals.filter(v => v !== null);
                
                if (vals.length > 0) {
                    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
                    const sd = vals.length > 1 ? Math.sqrt(vals.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / (vals.length - 1)) : 0;
                    
                    x.push(s); y.push(c); color.push(mean);
                    size.push(sd); 
                    text.push(`Strain: ${s}<br>Condition: ${c}<br>Avg ${metric}: ${mean.toFixed(3)}<br>Error (SD): ${sd.toFixed(3)}<br>n = ${vals.length} replicates`);
                }
            }
        });
    });

    const maxSd = Math.max(...size, 0.0001);
    const scaledSizes = size.map(sd => 15 + (sd / maxSd) * 25);

    const trace = {
        x: x, y: y, mode: 'markers', text: text, hoverinfo: 'text',
        marker: {
            size: scaledSizes, color: color, colorscale: 'Viridis', showscale: true,
            line: { color: 'rgba(0,0,0,0.5)', width: 1 }
        }
    };

    const layout = {
        title: { text: `Global Comparison: Average ${metric} (Bubble Size = Error)`, font: {weight: 'bold'} },
        xaxis: { title: 'Strain', gridcolor: '#eee', zeroline: false },
        yaxis: { title: 'Condition', gridcolor: '#eee', zeroline: false },
        margin: { t: 80, b: 80, l: 80, r: 80 },
        plot_bgcolor: "white", paper_bgcolor: "white"
    };

    Plotly.newPlot('bubble-chart', [trace], layout, {responsive: true});
}
