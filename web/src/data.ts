// The static game data, loaded once through the engine's validating loaders. Offline play
// needs no backend: these JSON files are bundled with the app (PROJECT.md 3.2a).
import {
  checkRulesAgainstDataset,
  createCtx,
  loadDataset,
  loadRules,
  type Ctx,
  type RuleSet,
} from '@auction/engine'
import playersRaw from '../../data/players.v1.json'
import rulesRaw from '../../data/rules.default.json'

function load(): { ctx: Ctx; rules: RuleSet } {
  const dataset = loadDataset(playersRaw)
  const rules = loadRules(rulesRaw)
  if (!dataset.ok) throw new Error(`players.v1.json is invalid:\n${dataset.errors.join('\n')}`)
  if (!rules.ok) throw new Error(`rules.default.json is invalid:\n${rules.errors.join('\n')}`)
  const cross = checkRulesAgainstDataset(rules.value, dataset.value)
  if (cross.errors.length > 0) throw new Error(`rules do not fit the dataset:\n${cross.errors.join('\n')}`)
  return { ctx: createCtx(dataset.value), rules: rules.value }
}

export const { ctx, rules } = load()
