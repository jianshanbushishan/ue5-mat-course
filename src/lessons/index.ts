import { ModuleDefinition, LessonDefinition } from '../types/course';
import { modules01_02 } from './modules01_02';
import { modules03_04 } from './modules03_04';
import { modules05_06 } from './modules05_06';
import { modules07_08 } from './modules07_08';
import { module09 } from './module09';
import { module10 } from './module10';

import { capstone } from './capstone';

export const ALL_MODULES: ModuleDefinition[] = [
  ...modules01_02,
  ...modules03_04,
  ...modules05_06,
  ...modules07_08,
  module09,
  module10,
  capstone,
];

export const ALL_LESSONS: LessonDefinition[] = ALL_MODULES.flatMap((m) => m.lessons);
