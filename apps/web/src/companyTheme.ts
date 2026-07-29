import { createTheme, alpha } from '@mui/material/styles';

// ─── Design Tokens ───────────────────────────────────────────────────────────
const CTA = '#96272d';
const CTA_HOVER = '#6b1a1e';
const CTA_PRESSED = '#4e1215';
const CTA_TINT = '#f9e8e9';   // chip fills, hover surfaces
const CTA_ALPHA06 = 'rgba(150,39,45,0.06)';
const CTA_ALPHA12 = 'rgba(150,39,45,0.12)';

const SECONDARY = '#3d5278';
const SECONDARY_DARK = '#243248';

const SURFACE = '#ffffff';
const CANVAS = '#f4f5f7';
const SIDEBAR = '#1c2028';

const GREY = {
    50: '#f8f8f9',
    100: '#f0f1f3',
    200: '#e2e4e8',
    300: '#cdd0d6',
    400: '#9fa4ae',
    500: '#72787f',
    600: '#545a63',
    700: '#3b4049',
    800: '#252b33',
    900: '#141820',
};

// ─── Theme ───────────────────────────────────────────────────────────────────
const theme = createTheme({

    // ── Palette ────────────────────────────────────────────────────────────────
    palette: {
        mode: 'light',

        primary: {
            light: '#c55b60',
            main: CTA,
            dark: CTA_HOVER,
            contrastText: '#ffffff',
        },

        secondary: {
            light: '#6b7fa3',
            main: SECONDARY,
            dark: SECONDARY_DARK,
            contrastText: '#ffffff',
        },

        error: { main: '#c62828', contrastText: '#ffffff' },
        warning: { main: '#e65100', contrastText: '#ffffff' },
        info: { main: '#0277bd', contrastText: '#ffffff' },
        success: { main: '#2e7d32', contrastText: '#ffffff' },

        grey: GREY,

        text: {
            primary: '#1c2028',
            secondary: GREY[600],
            disabled: GREY[400],
        },

        background: {
            default: CANVAS,
            paper: SURFACE,
        },

        divider: GREY[200],

        action: {
            active: alpha(CTA, 0.7),
            hover: CTA_ALPHA06,
            selected: CTA_ALPHA12,
            disabled: 'rgba(0,0,0,0.26)',
            disabledBackground: 'rgba(0,0,0,0.08)',
            focus: CTA_ALPHA12,
        },
    },

    // ── Typography ────────────────────────────────────────────────────────────
    typography: {
        fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
        fontSize: 14,

        h1: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em' },
        h2: { fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.25 },
        h3: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.3 },
        h4: { fontSize: '1.1rem', fontWeight: 600, lineHeight: 1.35 },
        h5: { fontSize: '1rem', fontWeight: 600, lineHeight: 1.4 },
        h6: {
            fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4,
            letterSpacing: '0.06em', textTransform: 'uppercase'
        },

        subtitle1: { fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.5 },
        subtitle2: { fontSize: '0.8125rem', fontWeight: 500, lineHeight: 1.5, color: GREY[600] },

        body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
        body2: { fontSize: '0.8125rem', lineHeight: 1.55 },

        button: { fontSize: '0.875rem', fontWeight: 600, letterSpacing: '0.02em', textTransform: 'none' },
        caption: { fontSize: '0.75rem', lineHeight: 1.5, color: GREY[500] },
        overline: { fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' },
    },

    // ── Shape ─────────────────────────────────────────────────────────────────
    shape: { borderRadius: 6 },

    // ── Spacing ───────────────────────────────────────────────────────────────
    spacing: 8,

    // ── Shadows ───────────────────────────────────────────────────────────────
    shadows: [
        'none',
        '0 1px 2px rgba(20,24,32,0.06)',
        '0 1px 4px rgba(20,24,32,0.08)',
        '0 2px 8px rgba(20,24,32,0.10)',
        '0 4px 12px rgba(20,24,32,0.12)',
        '0 6px 16px rgba(20,24,32,0.14)',
        '0 8px 20px rgba(20,24,32,0.14)',
        '0 10px 24px rgba(20,24,32,0.15)',
        '0 12px 28px rgba(20,24,32,0.15)',
        '0 14px 32px rgba(20,24,32,0.16)',
        '0 16px 36px rgba(20,24,32,0.16)',
        '0 18px 40px rgba(20,24,32,0.17)',
        '0 20px 44px rgba(20,24,32,0.17)',
        '0 22px 48px rgba(20,24,32,0.18)',
        '0 24px 52px rgba(20,24,32,0.18)',
        '0 26px 56px rgba(20,24,32,0.19)',
        '0 28px 60px rgba(20,24,32,0.19)',
        '0 30px 64px rgba(20,24,32,0.20)',
        '0 32px 68px rgba(20,24,32,0.20)',
        '0 34px 72px rgba(20,24,32,0.21)',
        '0 36px 76px rgba(20,24,32,0.21)',
        '0 38px 80px rgba(20,24,32,0.22)',
        '0 40px 84px rgba(20,24,32,0.22)',
        '0 42px 88px rgba(20,24,32,0.23)',
        '0 44px 92px rgba(20,24,32,0.24)',
    ],

    // ── Component Overrides ───────────────────────────────────────────────────
    components: {

        // ── Button ──────────────────────────────────────────────────────────────
        // v5: styleOverrides only accepts slot names (root, startIcon, endIcon…).
        // Variant/color-specific overrides go in `variants[]`.
        MuiButton: {
            defaultProps: {
                disableElevation: true,
                variant: 'contained',
            },
            styleOverrides: {
                root: {
                    borderRadius: 6,
                    padding: '7px 20px',
                    transition: 'background-color 150ms ease, box-shadow 150ms ease',
                    '&.Mui-disabled': {
                        backgroundColor: GREY[200],
                        color: GREY[400],
                    },
                },
                sizeSmall: {
                    padding: '4px 14px',
                    fontSize: '0.8125rem',
                },
                sizeLarge: {
                    padding: '10px 28px',
                    fontSize: '1rem',
                },
            },
            variants: [
                {
                    props: { variant: 'contained', color: 'primary' },
                    style: {
                        backgroundColor: CTA,
                        '&:hover': {
                            backgroundColor: CTA_HOVER,
                            boxShadow: '0 2px 8px rgba(150,39,45,0.35)',
                        },
                        '&:active': { backgroundColor: CTA_PRESSED },
                    },
                },
                {
                    props: { variant: 'outlined', color: 'primary' },
                    style: {
                        borderColor: CTA,
                        color: CTA,
                        '&:hover': {
                            backgroundColor: CTA_ALPHA06,
                            borderColor: CTA_HOVER,
                        },
                    },
                },
                {
                    props: { variant: 'text', color: 'primary' },
                    style: {
                        color: CTA,
                        '&:hover': { backgroundColor: CTA_ALPHA06 },
                    },
                },
            ],
        },

        // ── IconButton ──────────────────────────────────────────────────────────
        MuiIconButton: {
            styleOverrides: {
                root: {
                    borderRadius: 6,
                    '&:hover': { backgroundColor: CTA_ALPHA06 },
                    '&.MuiIconButton-colorPrimary': { color: CTA },
                },
            },
        },

        // ── App Bar ─────────────────────────────────────────────────────────────
        MuiAppBar: {
            defaultProps: { elevation: 0, color: 'primary' },
            styleOverrides: {
                colorPrimary: {
                    backgroundColor: CTA,
                    borderBottom: `1px solid ${CTA_HOVER}`,
                },
            },
        },

        // ── Drawer / Sidebar ────────────────────────────────────────────────────
        MuiDrawer: {
            styleOverrides: {
                paper: {
                    backgroundColor: SIDEBAR,
                    color: GREY[200],
                    borderRight: 'none',
                },
            },
        },

        // ── List Item (Nav links) ────────────────────────────────────────────────
        MuiListItemButton: {
            styleOverrides: {
                root: {
                    borderRadius: 4,
                    margin: '1px 8px',
                    width: 'calc(100% - 16px)',
                    '&:hover': { backgroundColor: 'rgba(255,255,255,0.06)' },
                    '&.Mui-selected': {
                        backgroundColor: CTA,
                        color: '#ffffff',
                        '& .MuiListItemIcon-root': { color: '#ffffff' },
                        '&:hover': { backgroundColor: '#c55b60' },
                    },
                },
            },
        },

        MuiListItemIcon: {
            styleOverrides: {
                root: { minWidth: 36, color: GREY[400] },
            },
        },

        // ── Card ────────────────────────────────────────────────────────────────
        MuiCard: {
            defaultProps: { elevation: 1 },
            styleOverrides: {
                root: {
                    borderRadius: 8,
                    border: `1px solid ${GREY[200]}`,
                    boxShadow: '0 1px 2px rgba(20,24,32,0.06)',
                },
            },
        },

        MuiCardHeader: {
            styleOverrides: {
                root: {
                    padding: '16px 20px 12px',
                    borderBottom: `1px solid ${GREY[100]}`,
                },
                title: { fontSize: '0.9375rem', fontWeight: 600 },
                subheader: { fontSize: '0.8125rem', color: GREY[500] },
            },
        },

        MuiCardContent: {
            styleOverrides: {
                root: {
                    padding: '16px 20px',
                    '&:last-child': { paddingBottom: 20 },
                },
            },
        },

        // ── Paper ────────────────────────────────────────────────────────────────
        MuiPaper: {
            defaultProps: { elevation: 0 },
            styleOverrides: {
                root: { backgroundImage: 'none' },
                outlined: { border: `1px solid ${GREY[200]}` },
                rounded: { borderRadius: 8 },
            },
        },

        // ── Table ────────────────────────────────────────────────────────────────
        MuiTableHead: {
            styleOverrides: {
                root: {
                    backgroundColor: GREY[100],
                    '& .MuiTableCell-root': {
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color: GREY[600],
                        borderBottom: `2px solid ${GREY[200]}`,
                    },
                },
            },
        },

        MuiTableRow: {
            styleOverrides: {
                root: {
                    '&:hover': { backgroundColor: GREY[50] },
                    '&.Mui-selected': {
                        backgroundColor: CTA_ALPHA06,
                        '&:hover': { backgroundColor: CTA_ALPHA12 },
                    },
                },
            },
        },

        MuiTableCell: {
            styleOverrides: {
                root: {
                    borderBottom: `1px solid ${GREY[100]}`,
                    fontSize: '0.875rem',
                    padding: '10px 16px',
                },
            },
        },

        // ── Chip ─────────────────────────────────────────────────────────────────
        // v5: compound keys like filledPrimary are deprecated — use root + selectors.
        MuiChip: {
            styleOverrides: {
                root: {
                    borderRadius: 4,
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    // filled primary
                    '&.MuiChip-filled.MuiChip-colorPrimary': {
                        backgroundColor: CTA,
                        color: '#ffffff',
                    },
                    // outlined / default primary tint
                    '&.MuiChip-outlined.MuiChip-colorPrimary': {
                        borderColor: CTA,
                        color: CTA,
                    },
                },
                // soft tint chip (use color="default" + custom sx, or rely on the above)
            },
        },

        // ── Badge ────────────────────────────────────────────────────────────────
        MuiBadge: {
            styleOverrides: {
                badge: {
                    '&.MuiBadge-colorPrimary': {
                        backgroundColor: CTA,
                        color: '#ffffff',
                    },
                },
            },
        },

        // ── Text Fields ──────────────────────────────────────────────────────────
        MuiTextField: {
            defaultProps: { variant: 'outlined', size: 'small' },
        },

        MuiOutlinedInput: {
            styleOverrides: {
                root: {
                    borderRadius: 6,
                    backgroundColor: SURFACE,
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: CTA },
                    '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: CTA,
                        borderWidth: 2,
                    },
                },
                notchedOutline: { borderColor: GREY[300] },
                input: { fontSize: '0.875rem' },
            },
        },

        MuiInputLabel: {
            styleOverrides: {
                root: {
                    fontSize: '0.875rem',
                    '&.Mui-focused': { color: CTA },
                },
            },
        },

        MuiFormHelperText: {
            styleOverrides: {
                root: { fontSize: '0.75rem', marginTop: 4 },
            },
        },

        MuiSelect: {
            styleOverrides: {
                icon: { color: GREY[500] },
            },
        },

        // ── Checkbox & Radio ─────────────────────────────────────────────────────
        MuiCheckbox: {
            styleOverrides: {
                root: {
                    color: GREY[400],
                    '&.Mui-checked': { color: CTA },
                    '&.MuiCheckbox-indeterminate': { color: CTA },
                },
            },
        },

        MuiRadio: {
            styleOverrides: {
                root: {
                    color: GREY[400],
                    '&.Mui-checked': { color: CTA },
                },
            },
        },

        // ── Switch ───────────────────────────────────────────────────────────────
        MuiSwitch: {
            styleOverrides: {
                root: {
                    '& .MuiSwitch-switchBase.Mui-checked': {
                        color: CTA,
                        '& + .MuiSwitch-track': {
                            backgroundColor: CTA,
                            opacity: 0.7,
                        },
                    },
                },
            },
        },

        // ── Tabs ─────────────────────────────────────────────────────────────────
        MuiTabs: {
            styleOverrides: {
                indicator: {
                    backgroundColor: CTA,
                    height: 3,
                    borderRadius: '3px 3px 0 0',
                },
            },
        },

        MuiTab: {
            styleOverrides: {
                root: {
                    textTransform: 'none',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                    minWidth: 80,
                    '&.Mui-selected': {
                        color: CTA,
                        fontWeight: 600,
                    },
                },
            },
        },

        // ── Tooltip ──────────────────────────────────────────────────────────────
        MuiTooltip: {
            defaultProps: { arrow: true },
            styleOverrides: {
                tooltip: {
                    backgroundColor: GREY[800],
                    fontSize: '0.75rem',
                    borderRadius: 4,
                },
                arrow: { color: GREY[800] },
            },
        },

        // ── Alert ────────────────────────────────────────────────────────────────
        // standardError / standardWarning etc. are deprecated compound class keys.
        // Correct v5 pattern: target via CSS selectors inside `root`.
        MuiAlert: {
            styleOverrides: {
                root: {
                    borderRadius: 6,
                    fontSize: '0.875rem',
                    // standard variant — one selector per severity
                    '&.MuiAlert-standard.MuiAlert-colorError': { backgroundColor: '#fdecea', color: CTA_HOVER },
                    '&.MuiAlert-standard.MuiAlert-colorWarning': { backgroundColor: '#fff3e0', color: '#7a3900' },
                    '&.MuiAlert-standard.MuiAlert-colorInfo': { backgroundColor: '#e3f2fd', color: '#014f86' },
                    '&.MuiAlert-standard.MuiAlert-colorSuccess': { backgroundColor: '#e8f5e9', color: '#1b5e20' },
                },
            },
        },

        // ── Dialog ───────────────────────────────────────────────────────────────
        MuiDialog: {
            styleOverrides: {
                paper: {
                    borderRadius: 10,
                    boxShadow: '0 20px 60px rgba(20,24,32,0.25)',
                },
            },
        },

        MuiDialogTitle: {
            styleOverrides: {
                root: { fontSize: '1rem', fontWeight: 600, padding: '20px 24px 12px' },
            },
        },

        MuiDialogContent: {
            styleOverrides: {
                root: { padding: '12px 24px', fontSize: '0.9rem' },
            },
        },

        MuiDialogActions: {
            styleOverrides: {
                root: { padding: '12px 24px 20px', gap: 8 },
            },
        },

        // ── Snackbar ─────────────────────────────────────────────────────────────
        MuiSnackbarContent: {
            styleOverrides: {
                root: { backgroundColor: GREY[800], fontSize: '0.875rem' },
            },
        },

        // ── Breadcrumbs ──────────────────────────────────────────────────────────
        MuiBreadcrumbs: {
            styleOverrides: {
                root: {
                    fontSize: '0.8125rem',
                    color: GREY[500],
                    '& a': {
                        color: CTA,
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' },
                    },
                },
            },
        },

        // ── Link ─────────────────────────────────────────────────────────────────
        MuiLink: {
            defaultProps: { underline: 'hover' },
            styleOverrides: {
                root: {
                    color: CTA,
                    fontWeight: 500,
                    '&:hover': { color: CTA_HOVER },
                },
            },
        },

        // ── Divider ──────────────────────────────────────────────────────────────
        MuiDivider: {
            styleOverrides: {
                root: { borderColor: GREY[200] },
            },
        },

        // ── Skeleton ─────────────────────────────────────────────────────────────
        MuiSkeleton: {
            styleOverrides: {
                root: { backgroundColor: GREY[100] },
            },
        },

        // ── Linear Progress ──────────────────────────────────────────────────────
        MuiLinearProgress: {
            styleOverrides: {
                root: { borderRadius: 4, backgroundColor: GREY[100] },
                bar: { backgroundColor: CTA },
            },
        },

        // ── Circular Progress ─────────────────────────────────────────────────────
        MuiCircularProgress: {
            defaultProps: { color: 'primary' },
            styleOverrides: {
                colorPrimary: { color: CTA },
            },
        },

        // ── Pagination ───────────────────────────────────────────────────────────
        MuiPaginationItem: {
            styleOverrides: {
                root: {
                    borderRadius: 4,
                    '&.Mui-selected': {
                        backgroundColor: CTA,
                        color: '#ffffff',
                        '&:hover': { backgroundColor: CTA_HOVER },
                    },
                },
            },
        },

        // ── Stepper ───────────────────────────────────────────────────────────────
        MuiStepIcon: {
            styleOverrides: {
                root: {
                    '&.Mui-active': { color: CTA },
                    '&.Mui-completed': { color: CTA },
                },
            },
        },
    },
});

export default theme;