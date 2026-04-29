import io
import re
import os
import itertools
import numpy as np
import pandas as pd
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from scipy.optimize import curve_fit
from scipy import stats

app = FastAPI()

# Priority Health Checks
@app.get("/health")
@app.get("/healthz")
async def health_check():
    return {"status": "healthy"}

@app.get("/ping")
async def ping():
    return "pong"



app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def time_to_hours(t):
    if pd.isna(t): return np.nan
    try:
        if isinstance(t, str):
            parts = t.split(':')
            if len(parts) == 3: return int(parts[0]) + int(parts[1])/60.0 + int(parts[2])/3600.0
            elif len(parts) == 2: return int(parts[0]) + int(parts[1])/60.0
        else:
            return t.hour + t.minute/60.0 + t.second/3600.0
    except: return np.nan
    return np.nan

def gompertz(t, A, um, l, y0):
    return y0 + (A - y0) * np.exp(-np.exp((um * np.e / (A - y0)) * (l - t) + 1))

def fit_growth_curve(t, y):
    # SAFETY: Reject empty or near-empty wells immediately to prevent crashes
    if len(y) < 5 or np.max(y) < 0.05:
        return [0.0, 0.0, 0.0, float(np.trapz(y, x=t)) if len(y) > 1 else 0.0]

    dynamic_range = np.max(y) - np.min(y)
    if dynamic_range < 0.1:
        return [0.0, 0.0, 0.0, float(np.trapz(y, x=t)) if len(y) > 1 else 0.0]

    
    y0_guess, A_guess = y.iloc[0], np.max(y)
    um_guess = (A_guess - np.min(y)) / (np.max(t) / 2) if np.max(t) > 0 else 0.1
    l_guess = t.iloc[np.argmax(np.diff(y))] if len(y) > 1 else 0
    
    try:
        auc = float(np.trapz(y, x=t))
    except AttributeError:
        auc = float(np.trapezoid(y, x=t))
        
    try:
        # Fit Gompertz with tighter constraints and a fallback
        popt, _ = curve_fit(gompertz, t, y, p0=[A_guess, um_guess, l_guess, y0_guess], 
                          bounds=([0, 0, 0, 0], [10, 10, 50, 2]), maxfev=5000)
        
        # If the optimizer just hits the upper bound for K or r on flat-ish data, it's a false positive
        if popt[0] >= 9.9 or popt[1] >= 9.9:
             return [0.0, 0.0, 0.0, auc]
             
        return [popt[0], popt[1], popt[2], auc]
    except:
        return [0.0, 0.0, 0.0, auc]



@app.post("/upload")
async def upload_files(files: list[UploadFile]):
    all_dfs = []
    
    for file in files:
        contents = await file.read()
        df_temp = pd.read_excel(io.BytesIO(contents), header=None)
        
        header_row = -1
        for idx, row in df_temp.iterrows():
            row_vals = [str(x).strip() for x in row.values]
            if 'Time' in row_vals and 'A1' in row_vals:
                header_row = idx
                break
        
        if header_row == -1:
            continue
            
        df = pd.read_excel(io.BytesIO(contents), header=header_row)
        df['Time_hours'] = df['Time'].apply(time_to_hours)
        df = df.dropna(subset=['Time_hours'])
        
        id_vars = ['Time_hours']
        wells = [f"{r}{c}" for r in 'ABCDEFGH' for c in range(1, 13)]
        val_vars = [w for w in wells if w in df.columns]
        
        df_melt = pd.melt(df, id_vars=id_vars, value_vars=val_vars, var_name='Well', value_name='OD')
        df_melt['File'] = file.filename
        all_dfs.append(df_melt)

    if not all_dfs:
        raise HTTPException(status_code=400, detail="No valid formatted data found.")

    final_df = pd.concat(all_dfs, ignore_index=True)
    final_df['OD'] = pd.to_numeric(final_df['OD'], errors='coerce')
    
    # Aggressively pre-compute mathematical physics curves unconditionally for 96-well grid UX
    params_list = []
    try:
        for (f, w), grp in final_df.dropna(subset=['OD']).groupby(['File', 'Well']):
            grp = grp.sort_values('Time_hours')
            try:
                K, r, lag, auc = fit_growth_curve(grp['Time_hours'], grp['OD'])
            except Exception as e:
                print(f"Error fitting Well {w} in {f}: {e}")
                K, r, lag, auc = 0.0, 0.0, 0.0, 0.0
                
            params_list.append({
                'File': f, 'Well': w,
                'K': 0.0 if pd.isna(K) else float(K),
                'r': 0.0 if pd.isna(r) else float(r),
                'lambda': 0.0 if pd.isna(lag) else float(lag),
                'auc': 0.0 if pd.isna(auc) else float(auc)
            })
    except Exception as outer_e:
        print(f"CRITICAL ERROR in upload loop: {outer_e}")
        
    params_df = pd.DataFrame(params_list)

    if not params_df.empty:
        final_df = pd.merge(final_df, params_df, on=['File', 'Well'], how='left')
    else:
        for c in ['K','r','lambda','auc']: final_df[c] = 0.0
        
    # FastAPI natively crashes with a 500 error if attempting to serialize np.nan into JSON. Convert to None.
    final_df = final_df.replace({np.nan: None})
        
    return {"raw_data": final_df.to_dict(orient="records")}

@app.post("/analyze")
async def analyze_data(payload: dict):
    raw_data = pd.DataFrame(payload["raw_data"])
    layout_map = payload["layout_map"] # { well_id: {Strain, Condition} }

    if raw_data.empty or not layout_map:
        raise HTTPException(status_code=400, detail="Missing data or layout mapping.")

    # Apply mapping
    raw_data['Strain'] = raw_data['Well'].map(lambda w: layout_map.get(w, {}).get('Strain', 'Unmapped'))
    raw_data['Condition'] = raw_data['Well'].map(lambda w: layout_map.get(w, {}).get('Condition', 'Unmapped'))
    df_valid = raw_data[raw_data['Strain'] != 'Unmapped'].dropna(subset=['OD'])

    results = []
    for (f, w, st, cnd), grp in df_valid.groupby(['File', 'Well', 'Strain', 'Condition']):
        # Since physics math is executed on Upload, simply aggregate the pre-computed constants
        results.append({
            'File': f, 'Well': w, 'Strain': st, 'Condition': cnd, 
            'K': float(grp['K'].iloc[0]), 'r': float(grp['r'].iloc[0]), 
            'lambda': float(grp['lambda'].iloc[0]), 'auc': float(grp['auc'].iloc[0])
        })

    merged_res = pd.DataFrame(results)
    
    # Calculate ANOVA & Pairwise Stats
    stats_out = {}
    pairwise_stats = {}
    if not merged_res.empty:
        merged_res['Group'] = merged_res['Strain'] + " | " + merged_res['Condition']
        groups = merged_res['Group'].unique()
        
        for param in ['K', 'r', 'lambda', 'auc']:
            stats_out[param] = {"f_val": None, "p_val": None}
            pairwise_stats[param] = {}
            
            samples = {g: merged_res[merged_res['Group'] == g][param].dropna() for g in groups}
            valid_groups = [g for g, s in samples.items() if len(s) > 0]
            
            if len(valid_groups) > 1:
                try:
                    f_val, p_val = stats.f_oneway(*[samples[g] for g in valid_groups])
                    stats_out[param] = {"f_val": float(f_val), "p_val": float(p_val)}
                except: pass
                
                for g1, g2 in itertools.combinations(valid_groups, 2):
                    if g1 not in pairwise_stats[param]: pairwise_stats[param][g1] = {}
                    if g2 not in pairwise_stats[param]: pairwise_stats[param][g2] = {}
                    try:
                        _, p = stats.ttest_ind(samples[g1], samples[g2], equal_var=False)
                        pairwise_stats[param][g1][g2] = float(p)
                        pairwise_stats[param][g2][g1] = float(p)
                    except: pass

    # Calculate Curves
    curve_data = {}
    if not df_valid.empty:
        df_valid['Group'] = df_valid['Strain'] + " | " + df_valid['Condition']
        df_valid['Time_hours_round'] = df_valid['Time_hours'].round(2)
        for g, grp in df_valid.groupby(['Group', 'Time_hours_round']):
            group_name = g[0]
            if group_name not in curve_data:
                curve_data[group_name] = {'time': [], 'mean': [], 'sd': []}
            curve_data[group_name]['time'].append(float(g[1]))
            curve_data[group_name]['mean'].append(float(grp['OD'].mean()))
            curve_data[group_name]['sd'].append(float(grp['OD'].std() if len(grp['OD']) > 1 else 0))

    # Calculate QC Data (Raw traces per group)
    qc_data = {}
    if not df_valid.empty:
        for g, grp in df_valid.groupby(['Group', 'File', 'Well']):
            group_name = g[0]
            if group_name not in qc_data:
                qc_data[group_name] = []
            qc_data[group_name].append({
                'file': g[1],
                'well': g[2],
                'time': [float(t) for t in grp['Time_hours']],
                'od': [float(o) for o in grp['OD']]
            })

    # Dump absolute raw curves unconditionally for 96-well grid mapping
    raw_all_curves = []
    if not raw_data.empty:
        for (f, w), grp in raw_data.groupby(['File', 'Well']):
            raw_all_curves.append({
                'file': f,
                'well': w,
                'time': [float(t) for t in grp['Time_hours']],
                'od': [float(o) for o in grp['OD']]
            })

    return {
        "parameters": merged_res.to_dict(orient="records") if not merged_res.empty else [],
        "statistics": stats_out,
        "pairwise_stats": pairwise_stats,
        "curves": curve_data,
        "qc_data": qc_data,
        "raw_all_curves": raw_all_curves
    }

# Mount static frontend over the root URL
frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
print(f"Mounting frontend from: {frontend_dir}")
if os.path.exists(frontend_dir):
    app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")
else:
    print(f"WARNING: Frontend directory not found at {frontend_dir}")

