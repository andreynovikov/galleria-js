export function bool(value) {
    return value === true || +value > 0 || String(value).toLowerCase().trim() in ['true', '1', 'yes']
}
