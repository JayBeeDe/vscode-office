import type { PPTXViewer } from "pptxviewjs";

/**
 * pptxviewjs (1.1.9) preloads pictures of slides and layouts through each part's own
 * relationships, but never the pictures placed on slide masters: those only render when an
 * unrelated part happens to cache the same rId. This loads master pictures the same way the
 * library loads layout pictures (per-part cache key) and points the shapes at those keys.
 *
 * Relies on the library's internal processor; any unexpected shape is skipped so rendering
 * falls back to the library's default behaviour.
 */
export async function loadMasterImages(viewer: PPTXViewer): Promise<void> {
    // PPTXViewer.processor is a PPTXProcessor wrapping the PPTXSlideRenderer that holds masters and the image cache
    const wrapper = (viewer as any).processor;
    const processor = wrapper?.slideMasters ? wrapper : wrapper?.processor;
    if (!processor?.slideMasters || !processor.package || !processor.zip || !processor.imageCache
        || !processor.imageLoader || typeof processor.extractImageRelationshipsFromSlide !== 'function'
        || typeof processor.updateShapeImageRelIds !== 'function') {
        return;
    }

    for (const master of processor.slideMasters) {
        const masterUri = master?.id;
        if (typeof masterUri !== 'string' || !masterUri.startsWith('/') || !master.commonSlideData?.shapeTree) {
            continue;
        }
        try {
            const relIds: string[] = processor.extractImageRelationshipsFromSlide(master);
            if (relIds.length === 0) {
                continue;
            }
            const rels = await processor.package.getPartByUri(masterUri)?.getRelationships();
            for (const relId of new Set(relIds)) {
                const target: string | undefined = rels?.[relId]?.target;
                if (!target) {
                    continue;
                }
                const imagePath = decodeURIComponent(new URL(target, `https://pptx${masterUri}`).pathname.slice(1));
                const cacheKey = `master:${masterUri}:${relId}`;
                if (!processor.imageCache.has(cacheKey)) {
                    await cacheImage(processor, imagePath, cacheKey);
                }
                if (processor.imageCache.has(cacheKey)) {
                    processor.updateShapeImageRelIds(master, relId, cacheKey);
                }
            }
        } catch {
            // keep the library's own behaviour for this master
        }
    }
}

async function cacheImage(processor: any, imagePath: string, cacheKey: string) {
    if (processor.isSVGFile?.(imagePath)) {
        return;
    }
    try {
        const imageData = await processor.zip.getFileData(imagePath);
        if (!imageData) {
            return;
        }
        const blob = new Blob([imageData], { type: processor.getMimeType?.(imagePath) ?? '' });
        const url = URL.createObjectURL(blob);
        const image = await processor.imageLoader.loadImageFromUrl(url);
        processor.imageCache.set(cacheKey, { image, url, path: imagePath, width: image.naturalWidth, height: image.naturalHeight });
    } catch {
        // unsupported format (e.g. WMF) or unreadable image: leave it uncached
    }
}
