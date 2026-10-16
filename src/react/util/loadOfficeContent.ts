export interface OfficeOpenPayload {
    path?: string;
    /** the file bytes: binary from the host, or a number array from older payloads */
    buffer?: number[] | Uint8Array | ArrayBuffer;
    error?: string;
}

export function arrayBufferFromPayload(payload: OfficeOpenPayload): ArrayBuffer {
    if (payload.error) {
        throw new Error(payload.error);
    }
    const { buffer } = payload;
    if (buffer instanceof ArrayBuffer) {
        if (!buffer.byteLength) throw new Error('Empty file content');
        return buffer;
    }
    if (buffer instanceof Uint8Array) {
        if (!buffer.byteLength) throw new Error('Empty file content');
        return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
    }
    if (!buffer?.length) {
        throw new Error('Empty file content');
    }
    const bytes = new Uint8Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
        bytes[i] = buffer[i];
    }
    return bytes.buffer;
}

export async function loadOfficeBuffer(payload: OfficeOpenPayload): Promise<ArrayBuffer> {
    if (payload.buffer) {
        return arrayBufferFromPayload(payload);
    }
    if (!payload.path) {
        throw new Error(payload.error ?? 'No file path');
    }
    const response = await fetch(payload.path);
    if (!response.ok) {
        throw new Error(`Failed to fetch (${response.status})`);
    }
    return response.arrayBuffer();
}
