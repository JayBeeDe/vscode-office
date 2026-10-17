import type { Plugin } from 'vite'
import { checkI18n } from '../scripts/i18n-check.mjs'

/** Checks i18n/<language>.json: errors fail a build, the dev server only reports them. */
export function i18nCheckPlugin(): Plugin {
  let isBuild = false
  const report = () => {
    const result = checkI18n()
    result.errors.forEach(error => console.error(`[i18n] ✖ ${error}`))
    if (result.warnings.length) {
      console.warn(`[i18n] ${result.warnings.length} warning(s), run npm run i18n:check -- --verbose to list them`)
    }
    return result
  }
  return {
    name: 'office-i18n-check',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    buildStart() {
      const { errors } = report()
      if (errors.length && isBuild) {
        this.error(`${errors.length} translation error(s), see above`)
      }
    },
    configureServer(server) {
      server.watcher.add('i18n/*.json')
      server.watcher.on('change', path => {
        if (/[\\/]i18n[\\/][\w-]+\.json$/.test(path)) report()
      })
    },
  }
}
