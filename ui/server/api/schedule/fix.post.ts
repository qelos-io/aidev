import { defineEventHandler } from 'h3';
import { fixSchedules } from '../../utils/schedule';

export default defineEventHandler(() => fixSchedules());
