export const ACTION_ORIGINAL = 0
export const ACTION_ZOOM = 1
export const ACTION_VIEW = 2
export const ACTION_INFO = 3
export const ACTION_EXPORT = 4
export const ACTION_THUMBNAIL = 5

export function bool(value) {
    return value === true || +value > 0 || String(value).toLowerCase().trim() in ['true', '1', 'yes']
}
