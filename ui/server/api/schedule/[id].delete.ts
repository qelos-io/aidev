import { defineEventHandler, createError, getRouterParam } from 'h3';
import { removeSchedule } from '../../utils/schedule';

export default defineEventHandler((event) => {
  const raw = getRouterParam(event, 'id');
  const id = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(id) || id < 1) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid schedule id' });
  }
  return removeSchedule(id);
});
