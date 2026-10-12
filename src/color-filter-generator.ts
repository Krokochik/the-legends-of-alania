const MAX_LOSS = 1065;

interface FilterResult {
    filter: string;
    filterRaw: string;
    loss: number;
    lossPercent: number;
    values: number[];
}

const filterCache = new Map<string, FilterResult>();

function expandHex(hextexp: string): string {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    return hextexp.replace(shorthandRegex, (_m, r, g, b) => r + r + g + g + b + b);
}

function rgbToHex(r: number, g: number, b: number): string {
    const componentToHex = (c: number): string => {
        const hex = c.toString(16);
        return hex.length === 1 ? "0" + hex : hex;
    };
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function hexToRgb(hex: string): [number, number, number] | null {
    const expandedHex = expandHex(hex);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expandedHex);
    return result
        ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16),
        ]
        : null;
}

class Color {
    r!: number;
    g!: number;
    b!: number;

    constructor(r: number, g: number, b: number) {
        this.set(r, g, b);
    }

    toRgb(): string {
        return `rgb(${Math.round(this.r)}, ${Math.round(this.g)}, ${Math.round(
            this.b
        )})`;
    }

    toHex(): string {
        return rgbToHex(Math.round(this.r), Math.round(this.g), Math.round(this.b));
    }

    set(r: number, g: number, b: number): void {
        this.r = this.clamp(r);
        this.g = this.clamp(g);
        this.b = this.clamp(b);
    }

    hueRotate(angle: number = 0): void {
        angle = (angle / 180) * Math.PI;
        const sin = Math.sin(angle);
        const cos = Math.cos(angle);

        this.multiply([
            0.213 + cos * 0.787 - sin * 0.213,
            0.715 - cos * 0.715 - sin * 0.715,
            0.072 - cos * 0.072 + sin * 0.928,
            0.213 - cos * 0.213 + sin * 0.143,
            0.715 + cos * 0.285 + sin * 0.14,
            0.072 - cos * 0.072 - sin * 0.283,
            0.213 - cos * 0.213 - sin * 0.787,
            0.715 - cos * 0.715 + sin * 0.715,
            0.072 + cos * 0.928 + sin * 0.072,
        ]);
    }

    grayscale(value: number = 1): void {
        this.multiply([
            0.2126 + 0.7874 * (1 - value),
            0.7152 - 0.7152 * (1 - value),
            0.0722 - 0.0722 * (1 - value),
            0.2126 - 0.2126 * (1 - value),
            0.7152 + 0.2848 * (1 - value),
            0.0722 - 0.0722 * (1 - value),
            0.2126 - 0.2126 * (1 - value),
            0.7152 - 0.7152 * (1 - value),
            0.0722 + 0.9278 * (1 - value),
        ]);
    }

    sepia(value: number = 1): void {
        this.multiply([
            0.393 + 0.607 * (1 - value),
            0.769 - 0.769 * (1 - value),
            0.189 - 0.189 * (1 - value),
            0.349 - 0.349 * (1 - value),
            0.686 + 0.314 * (1 - value),
            0.168 - 0.168 * (1 - value),
            0.272 - 0.272 * (1 - value),
            0.534 - 0.534 * (1 - value),
            0.131 + 0.869 * (1 - value),
        ]);
    }

    saturate(value: number = 1): void {
        this.multiply([
            0.213 + 0.787 * value,
            0.715 - 0.715 * value,
            0.072 - 0.072 * value,
            0.213 - 0.213 * value,
            0.715 + 0.285 * value,
            0.072 - 0.072 * value,
            0.213 - 0.213 * value,
            0.715 - 0.715 * value,
            0.072 + 0.928 * value,
        ]);
    }

    multiply(matrix: number[]): void {
        const newR = this.clamp(
            this.r * matrix[0] + this.g * matrix[1] + this.b * matrix[2]
        );
        const newG = this.clamp(
            this.r * matrix[3] + this.g * matrix[4] + this.b * matrix[5]
        );
        const newB = this.clamp(
            this.r * matrix[6] + this.g * matrix[7] + this.b * matrix[8]
        );
        this.r = newR;
        this.g = newG;
        this.b = newB;
    }

    brightness(value: number = 1): void {
        this.linear(value);
    }

    contrast(value: number = 1): void {
        this.linear(value, -(0.5 * value) + 0.5);
    }

    linear(slope: number = 1, intercept: number = 0): void {
        this.r = this.clamp(this.r * slope + intercept * 255);
        this.g = this.clamp(this.g * slope + intercept * 255);
        this.b = this.clamp(this.b * slope + intercept * 255);
    }

    invert(value: number = 1): void {
        this.r = this.clamp((value + (this.r / 255) * (1 - 2 * value)) * 255);
        this.g = this.clamp((value + (this.g / 255) * (1 - 2 * value)) * 255);
        this.b = this.clamp((value + (this.b / 255) * (1 - 2 * value)) * 255);
    }

    hsl(): { h: number; s: number; l: number } {
        const r = this.r / 255;
        const g = this.g / 255;
        const b = this.b / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h: number,
            s: number,
            l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r:
                    h = (g - b) / d + (g < b ? 6 : 0);
                    break;
                case g:
                    h = (b - r) / d + 2;
                    break;
                case b:
                    h = (r - g) / d + 4;
                    break;
                default:
                    h = 0;
            }
            h /= 6;
        }

        return {
            h: h * 100,
            s: s * 100,
            l: l * 100,
        };
    }

    clamp(value: number): number {
        if (value > 255) {
            value = 255;
        } else if (value < 0) {
            value = 0;
        }
        return value;
    }
}

class Solver {
    target: Color;
    targetHSL: { h: number; s: number; l: number };
    reusedColor: Color;

    constructor(target: Color) {
        this.target = target;
        this.targetHSL = target.hsl();
        this.reusedColor = new Color(0, 0, 0);
    }

    solveOnce(): { values: number[]; loss: number; filter: string; filterRaw: string } {
        const wide = this.spsa(
            5,
            [60, 180, 18000, 600, 1.2, 1.2],
            15,
            [50, 20, 3750, 50, 100, 100],
            1000
        );
        const A = wide.loss;
        const A1 = A + 1;
        const narrow = this.spsa(
            A,
            [0.25 * A1, 0.25 * A1, A1, 0.25 * A1, 0.2 * A1, 0.2 * A1],
            2,
            wide.values,
            500
        );
        return {
            values: narrow.values,
            loss: narrow.loss,
            filter: this.css(narrow.values),
            filterRaw: this.raw(narrow.values),
        };
    }

    spsa(
        A: number,
        a: number[],
        c: number,
        values: number[],
        iters: number
    ): { values: number[]; loss: number } {
        const alpha = 1;
        const gamma = 0.16666666666666666;

        let best: number[] | null = null;
        let bestLoss = Infinity;
        const deltas = new Array(6);
        const highArgs = new Array(6);
        const lowArgs = new Array(6);

        for (let k = 0; k < iters; k++) {
            const ck = c / Math.pow(k + 1, gamma);
            for (let i = 0; i < 6; i++) {
                deltas[i] = Math.random() > 0.5 ? 1 : -1;
                highArgs[i] = values[i] + ck * deltas[i];
                lowArgs[i] = values[i] - ck * deltas[i];
            }

            const lossDiff = this.loss(highArgs) - this.loss(lowArgs);
            for (let i = 0; i < 6; i++) {
                const g = (lossDiff / (2 * ck)) * deltas[i];
                const ak = a[i] / Math.pow(A + k + 1, alpha);
                values[i] = fix(values[i] - ak * g, i);
            }

            const loss = this.loss(values);
            if (loss < bestLoss) {
                best = values.slice(0);
                bestLoss = loss;
            }
        }
        return { values: best!, loss: bestLoss };

        function fix(value: number, idx: number): number {
            let max = 100;
            if (idx === 2) {
                max = 7500;
            } else if (idx === 4 || idx === 5) {
                max = 200;
            }

            if (idx === 3) {
                if (value > max) {
                    value %= max;
                } else if (value < 0) {
                    value = max + (value % max);
                }
            } else if (value < 0) {
                value = 0;
            } else if (value > max) {
                value = max;
            }
            return value;
        }
    }

    loss(filters: number[]): number {
        const color = this.reusedColor;
        color.set(0, 0, 0);

        color.invert(filters[0] / 100);
        color.sepia(filters[1] / 100);
        color.saturate(filters[2] / 100);
        color.hueRotate(filters[3] * 3.6);
        color.brightness(filters[4] / 100);
        color.contrast(filters[5] / 100);

        const colorHSL = color.hsl();
        return (
            Math.abs(color.r - this.target.r) +
            Math.abs(color.g - this.target.g) +
            Math.abs(color.b - this.target.b) +
            Math.abs(colorHSL.h - this.targetHSL.h) +
            Math.abs(colorHSL.s - this.targetHSL.s) +
            Math.abs(colorHSL.l - this.targetHSL.l)
        );
    }

    raw(filters: number[]): string {
        const fmt = (idx: number, multiplier: number = 1): number =>
            Math.round(filters[idx] * multiplier);
        return `brightness(0) saturate(100%) invert(${fmt(0)}%) sepia(${fmt(
            1
        )}%) saturate(${fmt(2)}%) hue-rotate(${fmt(3, 3.6)}deg) brightness(${fmt(
            4
        )}%) contrast(${fmt(5)}%)`;
    }

    css(filters: number[]): string {
        const fmt = (idx: number, multiplier: number = 1): number =>
            Math.round(filters[idx] * multiplier);
        return `brightness(0) saturate(100%) invert(${fmt(0)}%) sepia(${fmt(
            1
        )}%) saturate(${fmt(2)}%) hue-rotate(${fmt(3, 3.6)}deg) brightness(${fmt(
            4
        )}%) contrast(${fmt(5)}%)`;
    }
}

export function computeFilter(
    hex: string,
    maxDeviationPercent: number = 5,
    maxAttempts: number = 10
): FilterResult {
    let normalizedHex = hex.trim();
    if (!normalizedHex.startsWith("#")) {
        normalizedHex = "#" + normalizedHex;
    }
    normalizedHex = normalizedHex.toLowerCase();

    if (filterCache.has(normalizedHex)) {
        return filterCache.get(normalizedHex)!;
    }

    const rgb = hexToRgb(normalizedHex);
    if (!rgb) {
        throw new Error("Invalid hex color: " + hex);
    }

    const targetColor = new Color(rgb[0], rgb[1], rgb[2]);
    const maxLoss = (maxDeviationPercent / 100) * MAX_LOSS;
    const attempts = Math.max(1, maxAttempts);

    let bestResult: { values: number[]; loss: number; filter: string; filterRaw: string } | null = null;
    let bestLoss = Infinity;

    for (let attempt = 0; attempt < attempts; attempt++) {
        const solver = new Solver(targetColor);
        const result = solver.solveOnce();
        if (result.loss < bestLoss) {
            bestLoss = result.loss;
            bestResult = result;
        }
        if (result.loss <= maxLoss) {
            break;
        }
    }

    const finalResult: FilterResult = {
        filter: bestResult!.filter,
        filterRaw: bestResult!.filterRaw,
        loss: bestLoss,
        lossPercent: (bestLoss / MAX_LOSS) * 100,
        values: bestResult!.values,
    };

    filterCache.set(normalizedHex, finalResult);
    return finalResult;
}

export function clearFilterCache(): void {
    filterCache.clear();
}
