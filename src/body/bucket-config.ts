/** Where avatarkit's assets live in the shared asset bucket. No dependencies, so node tools can import it. */

/** The public URL of the shared asset bucket. */
export const ASSET_BUCKET = 'https://pub-32f6f3f21c18414cbeaf4bf0ac34ebe5.r2.dev'
/** The assetmgr indexes that hold every file of public/ (tools/mkassetmgr.ts writes them). */
export const AVATARKIT_INDEXES = ['avatarkit-body', 'avatarkit-wardrobe', 'avatarkit-targets', 'avatarkit-data'] as const
