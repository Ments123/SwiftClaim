import { secureMatterSpineSql } from '../schema.js';
import { defineMigration } from './types.js';

export const secureMatterSpineMigration = defineMigration({
  version: 1,
  name: 'secure matter spine',
  sql: secureMatterSpineSql,
});
