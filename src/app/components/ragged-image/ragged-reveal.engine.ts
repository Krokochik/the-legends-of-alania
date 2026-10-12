export type RaggedEasing =
    | 'linear'
    | 'smoothstep'
    | 'cubicOut'
    | 'quartOut'
    | 'quintOut'
    | 'expoOut'
    | 'circOut'
    | 'powerOut';

export interface RaggedRevealOptions {
    duration: number;
    hideDuration: number;
    delay: number;
    roughness: number;
    fine: number;
    motion: number;
    splatter: number;
    freezeAt: number;
    hideFreezeAt: number;
    easing: RaggedEasing;
    easingPower: number;
    originX: number;
    originY: number;
    testTexture: boolean;
}

export type RaggedImageSource = string | Blob | HTMLImageElement;

const DEFAULT_OPTIONS: RaggedRevealOptions = {
    duration: 1900,
    hideDuration: 650,
    delay: 0,
    roughness: 0.72,
    fine: 0.65,
    motion: 0.45,
    splatter: 0.58,
    freezeAt: 0.93,
    hideFreezeAt: 1,
    easing: 'powerOut',
    easingPower: 8,
    originX: 0.5,
    originY: 0.5,
    testTexture: true,
};

export class RaggedRevealEngine {
    readonly options: RaggedRevealOptions;

    private readonly canvas: HTMLCanvasElement;
    private readonly gl: WebGLRenderingContext;
    private readonly program: WebGLProgram;
    private readonly positionBuffer: WebGLBuffer;
    private readonly texture: WebGLTexture;

    private readonly locations: {
        position: number;
        image: WebGLUniformLocation | null;
        resolution: WebGLUniformLocation | null;
        imageResolution: WebGLUniformLocation | null;
        time: WebGLUniformLocation | null;
        progress: WebGLUniformLocation | null;
        roughness: WebGLUniformLocation | null;
        fine: WebGLUniformLocation | null;
        motion: WebGLUniformLocation | null;
        splatter: WebGLUniformLocation | null;
        origin: WebGLUniformLocation | null;
        hasImage: WebGLUniformLocation | null;
        testTexture: WebGLUniformLocation | null;
        opacity: WebGLUniformLocation | null;
        seed: WebGLUniformLocation | null;
        shapeProgress: WebGLUniformLocation | null;
    };

    private raf = 0;
    private destroyed = false;
    private resizeObserver?: ResizeObserver;

    private progress = 0;
    private opacity = 0;
    private seed = Math.random() * 1000;
    private shapeProgress = 0;
    private shapeLocked = false;
    private frozen = true;
    private freezeTime = performance.now() * 0.001;
    private shaderTime = this.freezeTime;
    private imageWidth = 1600;
    private imageHeight = 1000;
    private textureReady = false;
    private objectURL?: string;

    private animationId = 0;
    private activeAnimation?: {
        id: number;
        resolve: (completed: boolean) => void;
    };

    private _resize = () => this.resize();
    private _frame = (now: number) => this.frame(now);

    constructor(canvas: HTMLCanvasElement, options?: Partial<RaggedRevealOptions>) {
        this.canvas = canvas;
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
        };

        const gl = canvas.getContext('webgl', {
            alpha: true,
            antialias: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        });

        if (!gl) {
            throw new Error('WebGL не поддерживается этим браузером.');
        }

        this.gl = gl;
        this.program = this.createProgram(this.vertexShaderSource, this.fragmentShaderSource);
        gl.useProgram(this.program);

        this.positionBuffer = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([
                -1, -1, 1, -1, -1, 1,
                -1, 1, 1, -1, 1, 1,
            ]),
            gl.STATIC_DRAW,
        );

        this.locations = {
            position: gl.getAttribLocation(this.program, 'a_position'),
            image: gl.getUniformLocation(this.program, 'u_image'),
            resolution: gl.getUniformLocation(this.program, 'u_resolution'),
            imageResolution: gl.getUniformLocation(this.program, 'u_imageResolution'),
            time: gl.getUniformLocation(this.program, 'u_time'),
            progress: gl.getUniformLocation(this.program, 'u_progress'),
            roughness: gl.getUniformLocation(this.program, 'u_roughness'),
            fine: gl.getUniformLocation(this.program, 'u_fine'),
            motion: gl.getUniformLocation(this.program, 'u_motion'),
            splatter: gl.getUniformLocation(this.program, 'u_splatter'),
            origin: gl.getUniformLocation(this.program, 'u_origin'),
            hasImage: gl.getUniformLocation(this.program, 'u_hasImage'),
            testTexture: gl.getUniformLocation(this.program, 'u_testTexture'),
            opacity: gl.getUniformLocation(this.program, 'u_opacity'),
            seed: gl.getUniformLocation(this.program, 'u_seed'),
            shapeProgress: gl.getUniformLocation(this.program, 'u_shapeProgress'),
        };

        gl.enableVertexAttribArray(this.locations.position);
        gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

        this.texture = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            1,
            1,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            new Uint8Array([0, 0, 0, 255]),
        );

        gl.disable(gl.DEPTH_TEST);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0, 0, 0, 0);

        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(this._resize);
            this.resizeObserver.observe(canvas);
        } else {
            window.addEventListener('resize', this._resize);
        }

        this.resize();
        this.raf = requestAnimationFrame(this._frame);
    }

    get aspectRatio(): number {
        return this.imageWidth / Math.max(this.imageHeight, 1);
    }

    get hasImage(): boolean {
        return this.textureReady;
    }

    get currentProgress(): number {
        return this.progress;
    }

    get currentOpacity(): number {
        return this.opacity;
    }

    setOptions(partial: Partial<RaggedRevealOptions>): void {
        Object.assign(this.options, partial);
    }

    async loadImage(source: RaggedImageSource): Promise<HTMLImageElement> {
        if (source instanceof HTMLImageElement) {
            if (source.complete && source.naturalWidth > 0) {
                return source;
            }

            await new Promise<void>((resolve, reject) => {
                const onLoad = () => {
                    cleanup();
                    resolve();
                };
                const onError = () => {
                    cleanup();
                    reject(new Error('Не удалось загрузить изображение.'));
                };
                const cleanup = () => {
                    source.removeEventListener('load', onLoad);
                    source.removeEventListener('error', onError);
                };

                source.addEventListener('load', onLoad, {once: true});
                source.addEventListener('error', onError, {once: true});
            });

            return source;
        }

        let url: string;
        let shouldRevoke = false;

        if (source instanceof Blob) {
            url = URL.createObjectURL(source);
            shouldRevoke = true;
        } else {
            url = source;
        }

        try {
            const image = new Image();
            image.decoding = 'async';
            image.crossOrigin = 'anonymous';

            await new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error(`Не удалось загрузить изображение: ${url}`));
                image.src = url;
            });

            return image;
        } finally {
            if (shouldRevoke) {
                URL.revokeObjectURL(url);
            }
        }
    }

    uploadImage(image: HTMLImageElement): void {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            image,
        );

        this.imageWidth = image.naturalWidth || image.width || 1;
        this.imageHeight = image.naturalHeight || image.height || 1;
        this.textureReady = true;
    }

    clearImage(): void {
        this.textureReady = false;
        this.imageWidth = 1600;
        this.imageHeight = 1000;
    }

    async setImage(source: RaggedImageSource): Promise<void> {
        const image = await this.loadImage(source);
        this.uploadImage(image);
    }

    reveal(params: { duration?: number; delay?: number } = {}): Promise<boolean> {
        this.cancelAnimation();
        this.progress = 0;
        this.opacity = 0;
        this.seed = Math.random() * 1000;
        this.shapeProgress = 0;
        this.shapeLocked = false;
        this.frozen = false;
        return this.animateTo(1, 1, {
            duration: params.duration ?? this.options.duration,
            delay: params.delay ?? this.options.delay,
        });
    }

    hide(params: { duration?: number } = {}): Promise<boolean> {
        const freezeAt = this.getFreezeAt();
        this.shapeProgress = this.progress * freezeAt;
        this.shapeLocked = true;

        const hideFreezeAt = clamp01(this.options.hideFreezeAt);
        const target = this.progress * (1 - hideFreezeAt);
        this.frozen = true;
        this.freezeTime = this.shaderTime;

        return this.animateTo(target, 0, {
            duration: params.duration ?? this.options.hideDuration,
            delay: 0,
        });
    }

    replay(params: { duration?: number; delay?: number } = {}): Promise<boolean> {
        this.cancelAnimation();
        this.progress = 0;
        this.opacity = 0;
        this.frozen = false;
        return this.reveal(params);
    }

    private animateTo(
        targetProgress: number,
        targetOpacity: number,
        params: { duration: number; delay: number },
    ): Promise<boolean> {
        this.cancelAnimation();

        const id = ++this.animationId;
        const fromProgress = this.progress;
        const fromOpacity = this.opacity;
        const duration = Math.max(1, Number(params.duration) || this.options.duration);
        const delay = Math.max(0, Number(params.delay) || 0);
        const start = performance.now();

        return new Promise<boolean>((resolve) => {
            this.activeAnimation = {
                id,
                resolve,
            };

            const step = () => {
                if (this.destroyed) {
                    resolve(false);
                    return;
                }
                if (!this.activeAnimation || this.activeAnimation.id !== id) {
                    resolve(false);
                    return;
                }

                const now = performance.now();
                const raw = Math.max(0, (now - start - delay) / duration);
                const t = Math.min(1, raw);
                const eased = targetProgress < fromProgress
                    ? 1 - this.applyEasing(1 - t)
                    : this.applyEasing(t);

                this.progress = fromProgress + (targetProgress - fromProgress) * eased;
                this.opacity = fromOpacity + (targetOpacity - fromOpacity) * eased;

                if (t >= 1) {
                    this.progress = targetProgress;
                    this.opacity = targetOpacity;
                    if (!this.frozen) {
                        this.frozen = true;
                        this.freezeTime = now * 0.001;
                        this.shaderTime = this.freezeTime;
                    }

                    const active = this.activeAnimation;
                    this.activeAnimation = undefined;
                    active.resolve(true);
                    return;
                }

                this.raf = requestAnimationFrame(step);
            };

            this.raf = requestAnimationFrame(step);
        });
    }

    private cancelAnimation(): void {
        if (this.activeAnimation) {
            const active = this.activeAnimation;
            this.activeAnimation = undefined;
            active.resolve(false);
        }
        this.animationId++;
    }

    private getFreezeAt(): number {
        return Math.max(0.74, Math.min(0.99, Number(this.options.freezeAt) || 0.93));
    }

    private applyEasing(t: number): number {
        const x = Math.max(0, Math.min(1, t));
        const p = Math.max(2, Number(this.options.easingPower) || 8);

        switch (this.options.easing) {
            case 'linear':
                return x;
            case 'smoothstep':
                return x * x * (3 - 2 * x);
            case 'cubicOut':
                return 1 - Math.pow(1 - x, 3);
            case 'quartOut':
                return 1 - Math.pow(1 - x, 4);
            case 'quintOut':
                return 1 - Math.pow(1 - x, 5);
            case 'expoOut':
                return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
            case 'circOut':
                return Math.sqrt(1 - Math.pow(x - 1, 2));
            case 'powerOut':
            default:
                return 1 - Math.pow(1 - x, p);
        }
    }

    private resize(): void {
        if (this.destroyed) return;

        const rect = this.canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(rect.width * dpr));
        const height = Math.max(1, Math.round(rect.height * dpr));

        if (this.canvas.width === width && this.canvas.height === height) return;

        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }

    private frame(now: number): void {
        if (this.destroyed) return;

        const gl = this.gl;
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.enableVertexAttribArray(this.locations.position);
        gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        const freezeAt = this.getFreezeAt();
        const visualProgress = this.progress * freezeAt;
        const shaderTime = this.frozen ? this.freezeTime : now * 0.001;
        this.shaderTime = shaderTime;

        gl.uniform1i(this.locations.image, 0);
        gl.uniform2f(this.locations.imageResolution, this.imageWidth, this.imageHeight);
        gl.uniform2f(this.locations.resolution, this.canvas.width, this.canvas.height);
        gl.uniform1f(this.locations.time, shaderTime);
        gl.uniform1f(this.locations.progress, visualProgress);
        gl.uniform1f(this.locations.roughness, clamp01(this.options.roughness));
        gl.uniform1f(this.locations.fine, clamp01(this.options.fine));
        gl.uniform1f(this.locations.motion, clamp01(this.options.motion));
        gl.uniform1f(this.locations.splatter, clamp01(this.options.splatter));
        gl.uniform1f(this.locations.opacity, clamp01(this.opacity));
        gl.uniform1f(this.locations.seed, this.seed);
        gl.uniform1f(
            this.locations.shapeProgress,
            this.shapeLocked ? this.shapeProgress : visualProgress,
        );
        gl.uniform2f(
            this.locations.origin,
            clamp01(this.options.originX),
            clamp01(this.options.originY),
        );
        gl.uniform1f(this.locations.hasImage, this.textureReady ? 1 : 0);
        gl.uniform1f(this.locations.testTexture, this.options.testTexture ? 1 : 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
        this.raf = requestAnimationFrame(this._frame);
    }

    private createShader(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type)!;
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const log = this.gl.getShaderInfoLog(shader) || 'unknown shader error';
            this.gl.deleteShader(shader);
            throw new Error(log);
        }

        return shader;
    }

    private createProgram(vsSource: string, fsSource: string): WebGLProgram {
        const gl = this.gl;
        const vs = this.createShader(gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl.FRAGMENT_SHADER, fsSource);
        const program = gl.createProgram()!;

        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program) || 'unknown program link error';
            gl.deleteProgram(program);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            throw new Error(log);
        }

        gl.deleteShader(vs);
        gl.deleteShader(fs);
        return program;
    }

    private readonly vertexShaderSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

    private readonly fragmentShaderSource = `
    precision highp float;

    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_imageResolution;
    uniform float u_time;
    uniform float u_progress;
    uniform float u_roughness;
    uniform float u_fine;
    uniform float u_motion;
    uniform float u_splatter;
    uniform vec2 u_origin;
    uniform float u_hasImage;
    uniform float u_testTexture;
    uniform float u_opacity;
    uniform float u_seed;
    uniform float u_shapeProgress;

    varying vec2 v_uv;

    float hash21(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
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
      float sum = 0.0;
      float amp = 0.5;

      for (int i = 0; i < 5; i++) {
        sum += noise(p) * amp;
        p = p * 2.03 + vec2(11.7, 5.3);
        amp *= 0.5;
      }

      return sum;
    }

    vec2 coverUV(vec2 uv) {
      float canvasAspect = u_resolution.x / max(u_resolution.y, 1.0);
      float imageAspect = u_imageResolution.x / max(u_imageResolution.y, 1.0);

      if (imageAspect > canvasAspect) {
        float cropX = canvasAspect / imageAspect;
        uv.x = (uv.x - 0.5) * cropX + 0.5;
      } else {
        float cropY = imageAspect / canvasAspect;
        uv.y = (uv.y - 0.5) * cropY + 0.5;
      }

      return uv;
    }

    vec3 testTexture(vec2 uv, float time) {
      float gridX = smoothstep(0.49, 0.50, abs(fract(uv.x * 12.0) - 0.5));
      float gridY = smoothstep(0.49, 0.50, abs(fract(uv.y * 8.0) - 0.5));
      float grid = max(gridX, gridY);
      float glow = 0.50
        + 0.22 * sin(uv.x * 5.2 + time * 0.25)
        + 0.14 * cos(uv.y * 7.0 - time * 0.18);
      vec3 base = mix(vec3(0.055), vec3(0.16), clamp(glow, 0.0, 1.0));
      base += vec3(0.10) * grid;
      return base;
    }

    void main() {
      vec2 uv = v_uv;

      vec2 imageUV = coverUV(uv);
      vec4 texColor = texture2D(u_image, imageUV);
      vec3 placeholderColor = testTexture(uv, u_time);
      vec3 imageColor = mix(placeholderColor, texColor.rgb, u_hasImage);
      imageColor = mix(vec3(0.0), imageColor, max(u_hasImage, u_testTexture));

      vec2 origin = vec2(
        clamp(u_origin.x, 0.0, 1.0),
        1.0 - clamp(u_origin.y, 0.0, 1.0)
      );

      vec2 centered = uv - origin;
      float aspect = u_resolution.x / max(u_resolution.y, 1.0);
      centered.x *= aspect;

      float ox = origin.x;
      float oy = origin.y;
      float maxR = max(
        length(vec2((0.0 - ox) * aspect, 0.0 - oy)),
        max(
          length(vec2((1.0 - ox) * aspect, 0.0 - oy)),
          max(
            length(vec2((0.0 - ox) * aspect, 1.0 - oy)),
            length(vec2((1.0 - ox) * aspect, 1.0 - oy))
          )
        )
      );

      float radialR = length(centered) / max(maxR, 0.0001);
      float shapeProgress = u_shapeProgress;
      float shapeRadialR = shapeProgress;
      float angle = atan(centered.y, centered.x);
      vec2 dir = vec2(cos(angle), sin(angle));

      float motionFade = 1.0 - smoothstep(0.58, 1.0, shapeProgress);
      float movingTime = u_time * u_motion * motionFade;

      vec2 seedOffset = vec2(u_seed * 17.31, u_seed * -11.73);

      float large = fbm(
        dir * 2.65 + seedOffset
          + vec2(movingTime * 0.018, -movingTime * 0.014)
      );

      float medium = fbm(
        dir * 6.2 + vec2(13.1, -7.4) + seedOffset * 0.83
          + vec2(-movingTime * 0.036, movingTime * 0.027)
      );

      float radialField = fbm(
        vec2(shapeRadialR * 5.4, 0.0)
          + dir * 3.2
          + seedOffset * 0.61
          + vec2(movingTime * 0.025, -movingTime * 0.017)
      );

      float fineNoise = noise(
        dir * 40.0
          + vec2(shapeRadialR * 23.0, -shapeRadialR * 17.0)
          + seedOffset * 1.27
          + vec2(movingTime * 0.09, -movingTime * 0.07)
      );

      float edgeNoise = 0.0;
      edgeNoise += (large - 0.5) * (0.23 * u_roughness);
      edgeNoise += (medium - 0.5) * (0.13 * u_roughness);
      edgeNoise += (radialField - 0.5) * (0.08 * u_roughness);
      edgeNoise += (fineNoise - 0.5) * (0.032 * u_fine);

      float tearField = fbm(
        dir * 10.5
          + vec2(shapeRadialR * 7.0, shapeRadialR * 4.0)
          + seedOffset * 0.74
          + vec2(-movingTime * 0.045, movingTime * 0.031)
      );

      edgeNoise -= smoothstep(0.67, 0.93, tearField) * (0.12 * u_roughness);

      float revealRadius = u_progress * 1.08;
      float edgeStrength = mix(
        1.0,
        0.28,
        smoothstep(0.55, 1.0, shapeProgress)
      );
      float shapeScale = shapeProgress > 0.0001
        ? clamp(revealRadius / shapeProgress, 0.0, 1.0)
        : 0.0;

      float edgeRadius = revealRadius + edgeNoise * edgeStrength * shapeScale;
      float softness = mix(0.0035, 0.008, shapeProgress);

      float revealAlpha = 1.0 - smoothstep(
        edgeRadius - softness,
        edgeRadius + softness,
        radialR
      );

      float rim = 1.0 - smoothstep(
        0.002,
        0.045,
        abs(radialR - edgeRadius)
      );

      float micro = noise(
        uv * 115.0
          + seedOffset * 2.11
          + vec2(movingTime * 0.55, -movingTime * 0.37)
      );

      float holes = smoothstep(0.70, 0.98, micro);
      revealAlpha -= holes
        * rim
        * (0.22 * u_fine * u_motion * motionFade);

      vec2 cellUV = uv * 52.0 + seedOffset * 1.6;
      vec2 cell = floor(cellUV);
      vec2 local = fract(cellUV) - 0.5;
      float rnd = hash21(cell);
      float blobR = mix(0.10, 0.24, hash21(cell + vec2(17.0, 17.0) + vec2(u_seed * 5.0)));
      float blob = 1.0 - smoothstep(
        blobR,
        blobR + 0.04,
        length(local)
      );

      float flickRadius = 0.035
        + hash21(cell + vec2(8.0, 8.0) + vec2(u_seed * 7.0)) * 0.11;

      float nearFlick = 1.0 - smoothstep(
        flickRadius,
        flickRadius + 0.05,
        abs(radialR - edgeRadius)
      );

      float sparse = smoothstep(0.885, 0.99, rnd);
      float flecks = sparse * blob * nearFlick;

      float fleckVisibility = smoothstep(
        0.35,
        0.78,
        shapeProgress
      ) * (0.25 + 0.75 * u_splatter) * motionFade;

      revealAlpha = max(
        revealAlpha,
        flecks * fleckVisibility
      );

      float finalMicro = noise(
        uv * 145.0 + vec2(41.0, -17.0) + seedOffset * 2.73
      );

      float finalNib = smoothstep(0.94, 1.0, finalMicro)
        * 0.12
        * u_fine;

      float nearFinalRim = 1.0 - smoothstep(
        0.003,
        0.055,
        abs(radialR - edgeRadius)
      );

      revealAlpha = max(
        0.0,
        revealAlpha - finalNib * nearFinalRim
      );

      gl_FragColor = vec4(
        imageColor,
        clamp(revealAlpha * u_opacity, 0.0, 1.0)
      );
    }
  `;

    destroy(): void {
        if (this.destroyed) return;

        this.destroyed = true;
        cancelAnimationFrame(this.raf);
        this.cancelAnimation();

        this.resizeObserver?.disconnect();
        window.removeEventListener('resize', this._resize);

        if (this.objectURL) {
            URL.revokeObjectURL(this.objectURL);
        }

        this.gl.deleteTexture(this.texture);
        this.gl.deleteBuffer(this.positionBuffer);
        this.gl.deleteProgram(this.program);
    }
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

