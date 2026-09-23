/**
 * 单行文字往返滚动的位移。首尾各停 pause 秒，向左滚动后原路返回，不瞬移。
 * @param elapsed 本轮累计播放秒数；暂停时不增加。
 * @param distance 超出可见宽度的距离，设计像素；不超宽时返回 0。
 * @param speed 每秒移动的设计像素；非正数表示停止。
 * @param pause 首尾停留秒数，非正数表示不停留。
 * @returns 非正的 x 偏移，范围为 [-distance, 0]。
 */
export function marqueeOffset(elapsed: number, distance: number, speed: number, pause: number): number {
    if (![elapsed, distance, speed, pause].every(Number.isFinite)) throw new RangeError('滚动参数须为有限数值');
    if (distance <= 0 || speed <= 0) return 0;
    const hold = Math.max(0, pause),
        travel = distance / speed,
        cycle = 2 * (hold + travel);
    const t = Math.max(0, elapsed) % cycle;
    if (t < hold) return 0;
    if (t < hold + travel) return -(t - hold) * speed;
    if (t < 2 * hold + travel) return -distance;
    return -distance + (t - 2 * hold - travel) * speed;
}
