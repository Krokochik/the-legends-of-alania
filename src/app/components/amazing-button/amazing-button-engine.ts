export type AmazingButtonColors = readonly [string, string, string];

type Rgb = [number, number, number];
type Palette = [Rgb, Rgb, Rgb];

interface AmazingButtonEngineOptions {
    colors: AmazingButtonColors;
    seed: number;
    intensity: number;
}

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
__FRAGMENT_PRECISION__ float;

uniform vec2 u_resolution;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_colorC;
uniform float u_seed;
uniform float u_intensity;

float hash21(vec2 p) {
  p += vec2(u_seed * 0.173, u_seed * 0.317);
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 hash22(vec2 p) {
  return vec2(
    hash21(p + vec2(17.17, 31.71)),
    hash21(p + vec2(47.23, 11.91))
  );
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  mat2 rotateAndScale = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    value += amplitude * valueNoise(p);
    p = rotateAndScale * p + vec2(7.1, 3.7);
    amplitude *= 0.5;
  }
  return value;
}

float cellularEdge(vec2 p) {
  vec2 grid = floor(p);
  vec2 local = fract(p);
  float nearest = 10.0;
  float secondNearest = 10.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 id = grid + neighbor;
      vec2 jitter = hash22(id);
      vec2 site = 0.5 + (jitter - 0.5) * 1.32;
      float d = length(neighbor + site - local);
      if (d < nearest) {
        secondNearest = nearest;
        nearest = d;
      } else if (d < secondNearest) {
        secondNearest = d;
      }
    }
  }
  return secondNearest - nearest;
}

vec2 organicRings(vec2 p) {
  vec2 grid = floor(p);
  vec2 local = fract(p);
  float ringCore = 0.0;
  float ringHalo = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 id = grid + offset;
      float present = step(0.56, hash21(id + vec2(71.7, 13.2)));
      vec2 jitter = hash22(id + vec2(5.4, 19.8));
      vec2 site = 0.5 + (jitter - 0.5) * 1.07;
      vec2 delta = offset + site - local;
      float distanceToSite = length(delta);
      float angle = atan(delta.y, delta.x);
      float phase = hash21(id + vec2(23.1, 8.7)) * 6.28318;
      float wobble = 0.5
        + 0.24 * sin(angle * 2.0 + phase)
        + 0.15 * sin(angle * 5.0 - phase * 1.7);
      float radius = mix(0.29, 0.70, hash21(id + vec2(23.1, 8.7)));
      radius += (wobble - 0.5) * 0.115;
      float ringDistance = abs(distanceToSite - radius);
      float core = 1.0 - smoothstep(0.025, 0.135, ringDistance);
      float halo = 1.0 - smoothstep(0.07, 0.31, ringDistance);
      ringCore = max(ringCore, core * present);
      ringHalo = max(ringHalo, halo * present);
    }
  }
  return vec2(ringCore, ringHalo);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 broad = uv * vec2(4.0, 2.2) + vec2(u_seed * 0.0017, 4.3);
  float boundaryNoise = fbm(broad);
  float boundaryDetail = fbm(broad * 1.75 + vec2(8.7, u_seed * 0.0021));
  float boundary = uv.x
    + (boundaryNoise - 0.5) * 0.115
    + (boundaryDetail - 0.5) * 0.034;
  float toMiddle = smoothstep(0.445, 0.555, boundary);
  float toRed = smoothstep(0.635, 0.755, boundary);
  vec3 color = mix(u_colorA, u_colorB, toMiddle);
  color = mix(color, u_colorC, toRed);

  vec2 p = gl_FragCoord.xy / max(u_resolution.y, 1.0);
  vec2 flowBase = p * vec2(0.82, 2.10);
  float warpAX = fbm(flowBase * vec2(0.76, 1.23) + vec2(4.2, u_seed * 0.003));
  float warpAY = fbm(flowBase * vec2(0.91, 1.47) + vec2(17.3, 8.1));
  float warpBX = fbm(flowBase * vec2(1.45, 2.25) + vec2(u_seed * 0.004, 31.4));
  float warpBY = fbm(flowBase * vec2(1.61, 2.05) + vec2(12.6, u_seed * 0.005));
  vec2 liquid = flowBase
    + (vec2(warpAX, warpAY) - 0.5) * vec2(2.35, 1.28)
    + (vec2(warpBX, warpBY) - 0.5) * vec2(0.88, 0.64);

  float cloudLarge = fbm(liquid * vec2(0.72, 1.08) + vec2(4.4, 7.8));
  float cloudMedium = fbm(liquid * vec2(1.52, 2.42) + vec2(18.2, u_seed * 0.006));
  float cloudFine = fbm(liquid * vec2(2.85, 4.45) + vec2(6.7, 21.2));
  float fluidZone = smoothstep(0.345, 0.515, uv.x);
  float redZone = smoothstep(0.52, 0.76, uv.x);

  float pooledPigment = smoothstep(0.29, 0.62, cloudLarge)
    * (0.62 + 0.38 * smoothstep(0.29, 0.67, cloudMedium));
  float dilutedInk = smoothstep(0.32, 0.60, cloudMedium)
    * (1.0 - smoothstep(0.62, 0.81, cloudLarge));
  vec3 deepInk = mix(u_colorB * 0.36, u_colorC * 0.44, redZone);
  vec3 dilutedColor = mix(u_colorA * 0.92 + vec3(0.075),
                          u_colorB * 1.22 + vec3(0.10),
                          smoothstep(0.31, 0.62, uv.x));
  color = mix(color, deepInk, pooledPigment * fluidZone * u_intensity * 0.61);
  vec3 mistColor = mix(dilutedColor,
                       u_colorC * 1.36 + vec3(0.065, 0.035, 0.025),
                       redZone * 0.74);
  color = mix(color, mistColor, dilutedInk * fluidZone * u_intensity * 0.54);

  float veiledBloom = smoothstep(0.34, 0.55, cloudMedium)
    * (1.0 - smoothstep(0.59, 0.79, cloudMedium));
  vec3 bloomColor = mix(dilutedColor, mistColor, redZone * 0.46);
  color = mix(color, bloomColor, veiledBloom * fluidZone * u_intensity * 0.31);

  float cloudShade = smoothstep(0.32, 0.68, cloudLarge) * fluidZone;
  color = mix(color, color * 0.58 + deepInk * 0.42,
              cloudShade * u_intensity * 0.34);
  color *= 1.0 + (cloudFine - 0.5) * fluidZone * 0.28 * u_intensity;

  float contourField = fbm(liquid * vec2(1.28, 3.5) + vec2(23.7, 2.2));
  float contourDrift = (cloudLarge - 0.5) * 0.105;
  float foldA = 1.0 - smoothstep(0.025, 0.145,
      abs(contourField - (0.455 + contourDrift)));
  float foldB = 1.0 - smoothstep(0.035, 0.165,
      abs(contourField - (0.565 - contourDrift * 0.65)));
  float folds = max(foldA * 0.74, foldB * 0.54) * fluidZone;
  vec3 foldTint = mix(u_colorA * 0.78 + u_colorB * 0.22,
                      vec3(0.82, 0.88, 0.85), redZone * 0.74);
  color = mix(color, color * 0.76 + deepInk * 0.24,
              folds * u_intensity * 0.21);
  color = mix(color, foldTint, folds * dilutedInk * u_intensity * 0.29);

  float threadField = fbm(liquid * vec2(2.20, 4.8)
    + vec2(cloudMedium * 1.7, cloudLarge * 2.3));
  float threadA = 1.0 - smoothstep(0.025, 0.105, abs(threadField - 0.49));
  float threadB = 1.0 - smoothstep(0.035, 0.13, abs(threadField - 0.585));
  float threads = max(threadA * 0.55, threadB * 0.37)
    * fluidZone * smoothstep(0.39, 0.62, cloudMedium);
  color = mix(color, foldTint, threads * u_intensity * 0.22);

  float grain = hash21(floor(gl_FragCoord.xy * 0.72));
  color += (grain - 0.5) * 0.014 * u_intensity;
  color += (cloudFine - 0.5) * fluidZone * 0.055 * u_intensity;

  float cellSize = max(u_resolution.y / 2.55, 4.0);
  vec2 cellP = gl_FragCoord.xy / cellSize;
  vec2 warpA = vec2(
    fbm(cellP * 0.34 + vec2(u_seed * 0.0031, 5.2)),
    fbm(cellP * 0.34 + vec2(14.1, u_seed * 0.0037))
  );
  cellP += (warpA - 0.5) * 3.35;
  vec2 warpB = vec2(
    fbm(cellP * 0.82 + vec2(31.7, u_seed * 0.0043)),
    fbm(cellP * 0.82 + vec2(u_seed * 0.0049, 2.6))
  );
  cellP += (warpB - 0.5) * 1.04;

  float edgeDistance = cellularEdge(cellP);
  float softCellHalo = 1.0 - smoothstep(0.02, 0.34, edgeDistance);
  float softCellRim = 1.0 - smoothstep(0.05, 0.22, edgeDistance);
  vec2 rings = organicRings(cellP);

  float patternZone = smoothstep(0.405, 0.555, uv.x)
    * (1.0 - 0.30 * smoothstep(0.84, 0.995, uv.x));
  float patchNoise = fbm(cellP * 0.48 + vec2(7.2, u_seed * 0.005));
  float patches = mix(0.42, 1.0, smoothstep(0.25, 0.70, patchNoise));
  float strength = patternZone * patches * u_intensity;

  vec3 membraneLight = mix(
    mix(u_colorA, u_colorB, 0.52) * 0.82 + vec3(0.055),
    u_colorC * 0.54 + vec3(0.24, 0.20, 0.16),
    smoothstep(0.58, 0.84, uv.x) * 0.62
  );
  vec3 membraneShadow = mix(color * 0.70, deepInk * 0.72, redZone);

  color = mix(color, membraneShadow, softCellHalo * strength * 0.20);
  color = mix(color, membraneLight, softCellRim * strength * 0.22);

  color = mix(color, color * 0.73 + membraneShadow * 0.27,
              rings.y * strength * 0.23);
  color = mix(color, membraneLight, rings.x * strength * 0.40);

  float mottling = fbm(liquid * vec2(1.65, 3.4) + vec2(13.2, u_seed * 0.008));
  color *= 0.96 + mottling * fluidZone * 0.085;
  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(color, 1.0);
}
`;

export class AmazingButtonEngine {
    private readonly canvas: HTMLCanvasElement;
    private gl: WebGLRenderingContext | null = null;
    private fallbackContext: CanvasRenderingContext2D | null = null;
    private program: WebGLProgram | null = null;
    private positionBuffer: WebGLBuffer | null = null;
    private positionLocation = -1;
    private resolutionLocation: WebGLUniformLocation | null = null;
    private colorALocation: WebGLUniformLocation | null = null;
    private colorBLocation: WebGLUniformLocation | null = null;
    private colorCLocation: WebGLUniformLocation | null = null;
    private seedLocation: WebGLUniformLocation | null = null;
    private intensityLocation: WebGLUniformLocation | null = null;

    private palette: Palette;
    private seed: number;
    private intensity: number;
    private resizeObserver: ResizeObserver | null = null;
    private destroyed = false;

    private readonly handleWindowResize = (): void => this.resize();

    constructor(canvas: HTMLCanvasElement, options: AmazingButtonEngineOptions) {
        this.canvas = canvas;
        this.palette = this.parsePalette(options.colors);
        this.seed = Number.isFinite(options.seed) ? options.seed : Math.random() * 100_000;
        this.intensity = this.clamp(options.intensity, 0, 2);

        try {
            this.gl = this.canvas.getContext('webgl', {
                alpha: false,
                antialias: false,
                depth: false,
                stencil: false,
                premultipliedAlpha: false,
                preserveDrawingBuffer: false,
            });
        } catch {
            this.gl = null;
        }

        if (this.gl) {
            try {
                this.initializeWebGL();
            } catch (error) {
                console.error('[AmazingButton] WebGL initialization failed.', error);
                this.program = null;
            }
        } else {
            this.fallbackContext = this.canvas.getContext('2d');
        }

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.resize());
            this.resizeObserver.observe(this.canvas);
        } else if (typeof window !== 'undefined') {
            window.addEventListener('resize', this.handleWindowResize, {passive: true});
        }

        this.resize();
    }

    setColors(colors: AmazingButtonColors): void {
        this.palette = this.parsePalette(colors);
        this.render();
    }

    setSeed(seed: number): void {
        this.seed = Number.isFinite(seed) ? seed : Math.random() * 100_000;
        this.render();
    }

    setIntensity(intensity: number): void {
        this.intensity = this.clamp(Number.isFinite(intensity) ? intensity : 1, 0, 2);
        this.render();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;

        if (typeof window !== 'undefined') {
            window.removeEventListener('resize', this.handleWindowResize);
        }

        if (this.gl) {
            if (this.positionBuffer) this.gl.deleteBuffer(this.positionBuffer);
            if (this.program) this.gl.deleteProgram(this.program);
        }

        this.positionBuffer = null;
        this.program = null;
    }

    private initializeWebGL(): void {
        const gl = this.gl;
        if (!gl) return;

        const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision
            ? 'highp'
            : 'mediump';
        const fragmentSource = FRAGMENT_SHADER.replace('__FRAGMENT_PRECISION__', `precision ${precision}`);
        const vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER);
        const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
        const program = gl.createProgram();

        if (!program) throw new Error('Could not create a WebGL program.');
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const message = gl.getProgramInfoLog(program) || 'Unknown WebGL program link error.';
            gl.deleteProgram(program);
            throw new Error(message);
        }

        const buffer = gl.createBuffer();
        if (!buffer) {
            gl.deleteProgram(program);
            throw new Error('Could not create a WebGL vertex buffer.');
        }

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
            gl.STATIC_DRAW,
        );

        this.program = program;
        this.positionBuffer = buffer;
        this.positionLocation = gl.getAttribLocation(program, 'a_position');
        this.resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
        this.colorALocation = gl.getUniformLocation(program, 'u_colorA');
        this.colorBLocation = gl.getUniformLocation(program, 'u_colorB');
        this.colorCLocation = gl.getUniformLocation(program, 'u_colorC');
        this.seedLocation = gl.getUniformLocation(program, 'u_seed');
        this.intensityLocation = gl.getUniformLocation(program, 'u_intensity');

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
    }

    private compileShader(type: number, source: string): WebGLShader {
        const gl = this.gl;
        if (!gl) throw new Error('WebGL is unavailable.');

        const shader = gl.createShader(type);
        if (!shader) throw new Error('Could not create a WebGL shader.');
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader) || 'Unknown WebGL shader compilation error.';
            gl.deleteShader(shader);
            throw new Error(message);
        }

        return shader;
    }

    private resize(): void {
        if (this.destroyed) return;

        const rect = this.canvas.getBoundingClientRect();
        const dpr = typeof window === 'undefined'
            ? 1
            : Math.min(Math.max(window.devicePixelRatio || 1, 1), 2.5);
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));

        if (this.canvas.width !== width) this.canvas.width = width;
        if (this.canvas.height !== height) this.canvas.height = height;

        if (this.gl) this.gl.viewport(0, 0, width, height);
        this.render();
    }

    private render(): void {
        if (this.destroyed) return;

        if (this.gl && this.program && this.positionBuffer) {
            this.renderWebGL();
        } else if (this.fallbackContext) {
            this.renderFallback();
        } else if (this.gl) {
            const average = this.palette[1];
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            this.gl.clearColor(average[0], average[1], average[2], 1);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        }
    }

    private renderWebGL(): void {
        const gl = this.gl;
        const program = this.program;
        const buffer = this.positionBuffer;
        if (!gl || !program || !buffer) return;

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(this.positionLocation);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
        gl.uniform3fv(this.colorALocation, this.palette[0]);
        gl.uniform3fv(this.colorBLocation, this.palette[1]);
        gl.uniform3fv(this.colorCLocation, this.palette[2]);
        gl.uniform1f(this.seedLocation, this.seed);
        gl.uniform1f(this.intensityLocation, this.intensity);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    private renderFallback(): void {
        const ctx = this.fallbackContext;
        if (!ctx) return;

        const width = this.canvas.width;
        const height = this.canvas.height;
        const random = this.makeRandom(this.seed);
        const toRgba = (rgb: Rgb, alpha: number): string =>
            `rgba(${rgb.map((channel) => Math.round(channel * 255)).join(', ')}, ${alpha})`;
        const [colorA, colorB, colorC] = this.palette;

        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, toRgba(colorA, 1));
        gradient.addColorStop(0.44, toRgba(colorA, 1));
        gradient.addColorStop(0.55, toRgba(colorB, 1));
        gradient.addColorStop(0.65, toRgba(colorB, 1));
        gradient.addColorStop(0.76, toRgba(colorC, 1));
        gradient.addColorStop(1, toRgba(colorC, 1));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        const zoneColor = (x: number): Rgb => {
            const t = this.clamp((x / width - 0.46) / 0.28, 0, 1);
            return colorB.map((channel, i) => channel * (1 - t) + colorC[i] * t) as Rgb;
        };
        const textureAmount = this.clamp(this.intensity, 0, 2);
        if (textureAmount <= 0) return;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';

        const washes = Math.round((width / 8) * textureAmount);
        for (let i = 0; i < washes; i++) {
            const x = width * (0.34 + random() * 0.66);
            const y = height * (random() * 1.15 - 0.075);
            const rx = height * (0.24 + random() * 0.88);
            const ry = height * (0.13 + random() * 0.57);
            const rgb = zoneColor(x);
            const alpha = 0.025 + random() * 0.085;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate((random() - 0.5) * 1.3);
            ctx.scale(rx, ry);
            const wash = ctx.createRadialGradient(0, 0, 0.02, 0, 0, 1);
            wash.addColorStop(0, toRgba(rgb, alpha));
            wash.addColorStop(0.52, toRgba(rgb, alpha * 0.58));
            wash.addColorStop(1, toRgba(rgb, 0));
            ctx.fillStyle = wash;
            ctx.fillRect(-1, -1, 2, 2);
            ctx.restore();
        }

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.filter = `blur(${Math.max(0.4, height * 0.025)}px)`;
        const ribbons = Math.round((width / 21) * textureAmount);
        for (let i = 0; i < ribbons; i++) {
            const startX = width * (0.32 + random() * 0.72);
            let x = startX;
            let y = height * random();
            ctx.beginPath();
            ctx.moveTo(x, y);
            const segments = 2 + Math.floor(random() * 3);
            for (let segment = 0; segment < segments; segment++) {
                const drift = (random() - 0.32) * height * 0.95;
                const advance = height * (0.18 + random() * 0.62);
                ctx.bezierCurveTo(
                    x + advance * 0.22, y + drift * 0.25,
                    x + advance * 0.70, y + drift,
                    x + advance, y + drift * (0.25 + random() * 0.55),
                );
                x += advance;
                y += drift * (0.25 + random() * 0.55);
            }
            ctx.lineWidth = height * (0.035 + random() * 0.18);
            ctx.strokeStyle = toRgba(zoneColor(Math.min(width, Math.max(0, startX))), 0.075 + random() * 0.09);
            ctx.stroke();
        }
        ctx.filter = 'none';

        const threads = Math.round((width / 5.5) * textureAmount);
        for (let i = 0; i < threads; i++) {
            let x = width * (0.39 + random() * 0.59);
            let y = height * random();
            const rgb = zoneColor(x);
            ctx.beginPath();
            ctx.moveTo(x, y);
            const segments = 2 + Math.floor(random() * 3);
            for (let segment = 0; segment < segments; segment++) {
                const dx = height * (0.13 + random() * 0.48);
                const dy = (random() - 0.5) * height * 0.65;
                ctx.bezierCurveTo(
                    x + dx * 0.25, y + dy * 0.85,
                    x + dx * 0.6, y + dy * 1.2,
                    x + dx, y + dy,
                );
                x += dx;
                y += dy;
            }
            ctx.lineWidth = 0.45 + random() * Math.max(0.6, height * 0.025);
            ctx.strokeStyle = toRgba(rgb.map((channel) => channel * 0.58 + 0.42) as Rgb, 0.09 + random() * 0.16);
            ctx.stroke();
        }

        const cells = Math.max(5, Math.round((width / 24) * textureAmount));
        for (let i = 0; i < cells; i++) {
            const x = width * (0.42 + random() * 0.60);
            const y = height * random();
            const radiusX = height * (0.12 + random() * 0.36);
            const radiusY = height * (0.10 + random() * 0.34);
            const vertices = 7 + Math.floor(random() * 5);
            const points: Array<{ x: number; y: number }> = [];
            for (let j = 0; j < vertices; j++) {
                const angle = (j / vertices) * Math.PI * 2;
                const wobble = 0.70 + random() * 0.50;
                points.push({
                    x: x + Math.cos(angle) * radiusX * wobble,
                    y: y + Math.sin(angle) * radiusY * wobble,
                });
            }

            ctx.beginPath();
            ctx.moveTo((points[0].x + points[vertices - 1].x) * 0.5,
                (points[0].y + points[vertices - 1].y) * 0.5);
            for (let j = 0; j < vertices; j++) {
                const current = points[j];
                const next = points[(j + 1) % vertices];
                ctx.quadraticCurveTo(
                    current.x, current.y,
                    (current.x + next.x) * 0.5,
                    (current.y + next.y) * 0.5,
                );
            }
            ctx.closePath();
            const rgb = zoneColor(x);
            ctx.lineWidth = height * (0.045 + random() * 0.07);
            ctx.strokeStyle = toRgba(rgb.map((channel) => channel * 0.72 + 0.20) as Rgb, 0.055 + random() * 0.06);
            ctx.stroke();
            ctx.lineWidth = Math.max(0.6, height * (0.018 + random() * 0.02));
            ctx.strokeStyle = toRgba(rgb.map((channel) => channel * 0.48 + 0.42) as Rgb, 0.10 + random() * 0.12);
            ctx.stroke();
        }

        ctx.restore();
    }

    private parsePalette(colors: AmazingButtonColors): Palette {
        const defaults: Palette = [
            [0.31, 0.77, 0.82],
            [0.44, 0.53, 0.54],
            [0.68, 0.20, 0.11],
        ];

        return [0, 1, 2].map((index) => this.cssColorToRgb(colors[index], defaults[index])) as Palette;
    }

    private cssColorToRgb(color: string | undefined, fallback: Rgb): Rgb {
        if (typeof color !== 'string' || !color.trim()) return fallback;

        try {
            const context = document.createElement('canvas').getContext('2d');
            if (!context) return fallback;
            context.fillStyle = '#010203';
            context.fillStyle = color.trim();
            const normalized = context.fillStyle;

            const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
            if (hex) {
                let value = hex[1];
                if (value.length === 3) value = value.split('').map((digit) => digit + digit).join('');
                return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255) as Rgb;
            }

            const rgb = normalized.match(/^rgba?\(([^)]+)\)$/i);
            if (rgb) {
                const channels = rgb[1].split(/[\s,\/]+/).filter(Boolean).slice(0, 3);
                if (channels.length === 3) {
                    return channels.map((channel) => {
                        const value = channel.endsWith('%')
                            ? parseFloat(channel) * 2.55
                            : parseFloat(channel);
                        return this.clamp(value / 255, 0, 1);
                    }) as Rgb;
                }
            }
        } catch {
        }

        return fallback;
    }

    private makeRandom(seed: number): () => number {
        let state = (Math.floor(seed) || 1) >>> 0;
        return () => {
            state += 0x6D2B79F5;
            let t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
        };
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }
}
