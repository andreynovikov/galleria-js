export const ACTION_ORIGINAL = 0
export const ACTION_VIEW = 1
export const ACTION_INFO = 2
export const ACTION_EXPORT = 3
export const ACTION_THUMBNAIL = 4

export function bool(value) {
    return value === true || +value > 0 || String(value).toLowerCase().trim() in ['true', '1', 'yes']
}
