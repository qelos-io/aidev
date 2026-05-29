import { defineEventHandler } from 'h3';
import { getSchedulesSnapshot } from '../utils/schedule';

export default defineEventHandler(() => getSchedulesSnapshot());
