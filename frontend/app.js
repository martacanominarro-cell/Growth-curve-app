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

const BACKEND_URL = '';

// Initialize Grid
const rows = ['A','B','C','D','E','F','G','H'];
rows.forEach(r => {
    for(let c=1; c<=12; c++) {
        const wellId = `${r}${c}`;
        const div = document.createElement('div');
        div.className = 'well';
        div.innerText = wellId;
        div.dataset.well = wellId;
        
        div.addEventListener('click', () => {
            if(selectedWells.has(wellId)) {
                selectedWells.delete(wellId);
                div.classList.remove('selected');
            } else {
                selectedWells.add(wellId);
                div.classList.add('selected');
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

function getThemeColors() {
    const theme = document.getElementById('color-theme').value;
    if(theme === 'publication') return ['#111111', '#555555', '#2c7fb8', '#7fcdbb', '#edf8b1'];
    if(theme === 'vibrant') return ['#FF0054', '#9E0059', '#390099', '#FFBD00', '#FF5400'];
    return ['#f59700', '#df582c', '#8a1100', '#a058d8', '#6a86ff', '#9fcafb'];
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
    const colors = getThemeColors();
    
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
        activeTargets = ['curve-chart', 'k-chart', 'r-chart', 'lambda-chart'];
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
        <div class="stat-item">lambda p-value: <span>${smap?.['lambda']?.p_val?.toExponential(3) || 'N/A'}</span></div>
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
            const vals = params.filter(p => `${p.Strain} | ${p.Condition}` === g).map(p => p[metric]);
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
    plotBar('lambda-chart', 'lambda', 'Lag Time (lambda)');
    
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
}

document.getElementById('download-csv').addEventListener('click', () => {
    if(!latestResults || !latestResults.parameters) return alert("No parameters extracted yet!");
    const ws = XLSX.utils.json_to_sheet(latestResults.parameters);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Parameters");
    XLSX.writeFile(wb, "Growth_Parameters_Export.xlsx");
});
