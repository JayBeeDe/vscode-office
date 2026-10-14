import './polyfills/buffer';
import ReactDOM from 'react-dom/client';
import './util/vscode.js';
import { getConfigs } from './util/vscodeConfig.ts';
import { initI18n, $t } from './i18n/i18nConfig.ts';
import './main.css'
import { ConfigProvider } from 'antd';
import { lazy } from 'react';
import { antThemeConfig } from './antThemeConfig.ts';
const Excel = lazy(() => import('./view/excel/Excel.tsx'))
const Word = lazy(() => import('./view/word/Word.tsx'))
const PowerPoint = lazy(() => import('./view/powerpoint/PowerPoint.tsx'))
const Epub = lazy(() => import('./view/epub/Epub.tsx'))
const XmindViewer = lazy(() => import('./view/xmind/XmindViewer.tsx'))
const Parquet = lazy(() => import('./view/parquet/Parquet.tsx'))

document.getElementById('_defaultStyles')?.parentNode?.removeChild(document.getElementById('_defaultStyles'))
const configs = getConfigs();
initI18n(configs?.language);

export default function App() {
  const route = configs?.route
  switch (route) {
    case 'excel':
      return <Excel />
    case 'word':
      return <Word />
    case 'ppt':
      return <PowerPoint />
    case 'epub':
      return <Epub />
    case 'xmind':
      return <XmindViewer />
    case 'parquet':
      return <Parquet />
    default:
      return <>{$t('common.officeViewer')}</>
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ConfigProvider
    componentSize='small'
    theme={antThemeConfig}
  >
    <App />
  </ConfigProvider>
)
