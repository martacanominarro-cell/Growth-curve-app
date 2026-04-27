import pandas as pd
import numpy as np
import io

df = pd.DataFrame({
    'Time': ['0:00', '1:00', '2:00'],
    'A1': [0.1, 0.2, 0.3],
    'A2': [0.1, 0.2, 0.3]
})
content = io.BytesIO()
df.to_excel(content, index=False)
content.seek(0)

from backend.main import time_to_hours, fit_growth_curve

df_read = pd.read_excel(content)
df_read['Time_hours'] = df_read['Time'].apply(time_to_hours)

df_melt = pd.melt(df_read, id_vars=['Time_hours'], value_vars=['A1', 'A2'], var_name='Well', value_name='OD')
df_melt['File'] = 'test.xlsx'

params_list = []
for (f, w), grp in df_melt.dropna(subset=['OD']).groupby(['File', 'Well']):
    grp = grp.sort_values('Time_hours')
    print(f"fitting {f} {w}")
    K, r, lag, auc = fit_growth_curve(grp['Time_hours'], grp['OD'])
    params_list.append({
        'File': f, 'Well': w,
        'K': 0.0 if pd.isna(K) else float(K),
        'r': 0.0 if pd.isna(r) else float(r),
        'lambda': 0.0 if pd.isna(lag) else float(lag),
        'auc': 0.0 if pd.isna(auc) else float(auc)
    })
print("success!")
