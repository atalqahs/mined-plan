import type { DomainErrorCode } from '@/domain/rules/errors';
import type { CommandLabel } from '@/application/commands/mindCommands';
import type { RepeatRule, NodeStatus } from '@/domain/entities/types';

/** All user-facing copy (Modern Standard Arabic). Code identifiers stay English. */
export const t = {
  appName: 'مِدار',
  appTagline: 'خريطة عقلك في مدارٍ واحد',

  toolbar: {
    search: 'ابحث في أفكارك',
    searchShortcut: 'Ctrl+K',
    addIdea: 'إضافة فكرة',
    focus: 'وضع التركيز',
    focusExtended: 'تركيز موسّع',
    focusDirect: 'تركيز مباشر',
    notifications: 'التنبيهات',
    settings: 'الإعدادات',
    undo: 'تراجع',
    redo: 'إعادة',
    resetView: 'إعادة ضبط المنظور',
    saved: 'محفوظ',
    saving: 'جارٍ الحفظ…',
    saveError: 'تعذّر الحفظ، ستتم إعادة المحاولة',
  },

  search: {
    noResults: 'لا توجد فكرة تطابق بحثك',
    inCategory: 'في التصنيف',
    inNotes: 'في الملاحظات',
    resultsLabel: 'نتائج البحث',
    primary: 'فكرة رئيسية',
  },

  add: {
    title: 'فكرة جديدة',
    nameLabel: 'عنوان الفكرة',
    namePlaceholder: 'مثال: إطلاق المشروع الجديد',
    parentLabel: 'موضعها في الشبكة',
    asPrimary: 'فكرة رئيسية حول الدماغ',
    under: (title: string) => `فرعية تحت «${title}»`,
    categoryLabel: 'التصنيف',
    categoryPlaceholder: 'عمل، صحة، تعلّم…',
    submit: 'أضف الفكرة',
    cancel: 'إلغاء',
  },

  details: {
    panelLabel: 'تفاصيل الفكرة',
    close: 'إغلاق اللوحة',
    titleLabel: 'العنوان',
    notesLabel: 'الوصف والملاحظات',
    notesPlaceholder: 'دوّن ما يدور في ذهنك حول هذه الفكرة…',
    categoryLabel: 'التصنيف',
    statusLabel: 'الحالة',
    colorLabel: 'اللون',
    defaultColor: 'اللون الافتراضي',
    parentLabel: 'الفكرة الأم',
    noParent: 'فكرة رئيسية — تدور حول الدماغ مباشرة',
    move: 'نقل',
    moveTo: 'انقلها إلى',
    moveToRoot: 'اجعلها فكرة رئيسية',
    moveSearch: 'ابحث عن الفكرة الأم الجديدة',
    childrenLabel: 'الأفكار الفرعية',
    noChildren: 'لا توجد أفكار فرعية بعد.',
    addChild: 'إضافة فكرة فرعية',
    addChildPlaceholder: 'عنوان الفكرة الفرعية ثم Enter',
    relatedLabel: 'أفكار مرتبطة',
    noRelated: 'اربط هذه الفكرة بأي فكرة أخرى مهما كان موقعها.',
    connect: 'ربط بفكرة',
    connectSearch: 'ابحث عن الفكرة التي تريد الربط بها',
    connectIn3d: 'أو انقر فكرة في المشهد',
    relationPlaceholder: 'نوع العلاقة (اختياري)',
    removeLink: 'إزالة الربط',
    deadlineLabel: 'الموعد النهائي',
    clearDeadline: 'إزالة الموعد',
    remindersLabel: 'التذكيرات',
    noReminders: 'لا توجد تذكيرات لهذه الفكرة.',
    addReminder: 'إضافة تذكير',
    reminderWhen: 'موعد التذكير',
    reminderRepeat: 'التكرار',
    delete: 'حذف الفكرة',
    focusHere: 'ركّز على هذه الفكرة',
    created: 'أُنشئت',
    updated: 'آخر تعديل',
  },

  status: {
    active: 'نشطة',
    completed: 'مكتملة',
    archived: 'مؤرشفة',
  } satisfies Record<NodeStatus, string>,

  repeat: {
    none: 'بلا تكرار',
    daily: 'يوميًا',
    weekly: 'أسبوعيًا',
    monthly: 'شهريًا',
    yearly: 'سنويًا',
  } satisfies Record<RepeatRule | 'none', string>,

  reminders: {
    title: 'التنبيهات',
    overdue: 'متأخرة',
    today: 'اليوم',
    upcoming: 'القادمة',
    completed: 'مكتملة',
    complete: 'تمّ',
    reopen: 'إعادة فتح',
    remove: 'حذف التذكير',
    open: 'انتقل إلى الفكرة',
    empty: 'لا توجد تذكيرات في هذه المجموعة.',
    emptyAll: 'لا توجد تذكيرات بعد. أضف تذكيرًا من لوحة أي فكرة.',
    missed: 'فات موعده أثناء إغلاق التطبيق',
    unknownNode: 'فكرة محذوفة',
    permissionPrompt: 'فعّل إشعارات المتصفح لتصلك التذكيرات حتى وأنت في تبويب آخر.',
    enable: 'تفعيل الإشعارات',
    permissionDenied: 'إشعارات المتصفح محظورة. يمكنك السماح بها من إعدادات الموقع في المتصفح، وستظهر التذكيرات داخل التطبيق في كل الأحوال.',
    unsupported: 'هذا المتصفح لا يدعم الإشعارات، ستظهر التذكيرات داخل التطبيق فقط.',
    limitation: 'تعمل التذكيرات ما دام التطبيق مفتوحًا في أحد التبويبات. ما يحين أثناء الإغلاق يظهر هنا عند الفتح التالي.',
    dueToast: (title: string) => `حان موعد: ${title}`,
    missedToast: (n: number) => (n === 1 ? 'فات موعد تذكير واحد أثناء إغلاق التطبيق' : `فاتت مواعيد ${n} تذكيرات أثناء إغلاق التطبيق`),
    notificationTitle: 'تذكير من مِدار',
  },

  focus: {
    active: 'وضع التركيز',
    direct: 'مباشر',
    extended: 'موسّع',
    levelLabel: 'مدى التركيز',
    exit: 'الخروج من وضع التركيز',
    bannerDirect: (title: string) => `تركيز مباشر على «${title}»`,
    bannerExtended: (title: string) => `تركيز موسّع حول «${title}»`,
    needSelection: 'اختر فكرة أولًا ثم فعّل وضع التركيز',
    related: (n: number) => (n === 0 ? 'لا روابط' : n === 1 ? 'فكرة واحدة مرتبطة' : n === 2 ? 'فكرتان مرتبطتان' : n <= 10 ? `${n} أفكار مرتبطة` : `${n} فكرة مرتبطة`),
  },

  settings: {
    title: 'الإعدادات',
    notifications: 'الإشعارات',
    permission: {
      granted: 'مسموح بها',
      denied: 'محظورة من المتصفح',
      default: 'لم تُطلب بعد',
      unsupported: 'غير مدعومة',
    },
    display: 'العرض',
    labelDensity: 'كثافة العناوين في المشهد',
    density: { low: 'هادئة', balanced: 'متوازنة', high: 'كثيفة' },
    motion: 'الحركة',
    motionOptions: { system: 'حسب إعدادات النظام', reduced: 'مخفّضة', full: 'كاملة' },
    ambient: 'نبض عصبي هادئ في الدماغ',
    ambientHint: 'يتوقف تلقائيًا عند تخفيف الحركة أو إخفاء التبويب.',
    network: 'الشبكة',
    relayout: 'إعادة توزيع الشبكة',
    relayoutHint: 'يعيد ترتيب كل الأفكار في مدارات متباعدة. يمكنك التراجع عنه.',
    data: 'البيانات والنسخ الاحتياطي',
    export: 'تصدير نسخة JSON',
    import: 'استيراد نسخة JSON',
    importHint: 'يُحفظ تلقائيًا نسخة احتياطية محلية من بياناتك الحالية قبل أي استيراد.',
    storage: { indexeddb: 'تُحفظ بياناتك محليًا على هذا الجهاز تلقائيًا.', memory: 'تنبيه: التخزين المحلي غير متاح، لن تبقى بياناتك بعد إعادة التحميل. صدّر نسخة احتياطية.' },
    localBackups: (n: number) => (n ? `نسخ احتياطية محلية تلقائية: ${n}` : 'لا توجد نسخ احتياطية تلقائية بعد'),
    shortcuts: 'اختصارات لوحة المفاتيح',
    close: 'إغلاق الإعدادات',
  },

  shortcuts: [
    ['Ctrl+K', 'البحث'],
    ['N', 'إضافة فكرة'],
    ['F', 'وضع التركيز'],
    ['Shift+F', 'تبديل مدى التركيز'],
    ['L', 'ربط الفكرة المحددة بأخرى'],
    ['← →', 'التنقل بين الأفكار المرتبطة'],
    ['↑ ↓', 'الانتقال إلى الأم / أول فرع'],
    ['Delete', 'حذف الفكرة المحددة'],
    ['Ctrl+Z', 'تراجع'],
    ['Ctrl+Shift+Z', 'إعادة'],
    ['Esc', 'إغلاق / خروج'],
  ] as const,

  importFlow: {
    title: 'استيراد نسخة احتياطية',
    summary: (n: number, e: number, r: number) => `تحتوي النسخة على ${n} فكرة و${e} رابط و${r} تذكير.`,
    replaceWarning: 'سيحلّ محتوى النسخة محلّ شبكتك الحالية. ستُحفظ نسخة احتياطية من بياناتك الحالية أولًا، ويمكنك التراجع فورًا.',
    issues: 'ملاحظات على الملف:',
    issue: (code: string) => {
      const [k, n] = code.split(':');
      const map: Record<string, string> = {
        'invalid-nodes': `${n} فكرة غير صالحة لن تُستورد`,
        'invalid-edges': `${n} رابط غير صالح لن يُستورد`,
        'invalid-reminders': `${n} تذكير غير صالح لن يُستورد`,
        orphans: `${n} فكرة فقدت أمها وستصبح رئيسية`,
        cycles: `${n} حلقة هرمية ستُفك`,
        edges: `${n} رابط يشير إلى أفكار غير موجودة`,
        reminders: `${n} تذكير يشير إلى أفكار غير موجودة`,
      };
      return map[k] ?? code;
    },
    confirm: 'استبدل الشبكة',
    cancel: 'إلغاء',
    done: 'تم الاستيراد بنجاح',
    errors: {
      INVALID_JSON: 'الملف ليس JSON صالحًا.',
      NOT_A_BACKUP: 'هذا الملف ليس نسخة احتياطية من مِدار.',
      UNSUPPORTED_VERSION: 'إصدار النسخة أحدث من هذا التطبيق، حدّث التطبيق ثم أعد المحاولة.',
      SCHEMA_MISMATCH: 'محتوى الملف لا يطابق بنية بيانات مِدار.',
    } as Record<string, string>,
    readError: 'تعذّرت قراءة الملف.',
    exported: 'تم تصدير النسخة الاحتياطية',
  },

  del: {
    title: (name: string) => `حذف «${name}»؟`,
    body: 'ستُحذف الفكرة مع روابطها وتذكيراتها. يمكنك التراجع مباشرة بعد الحذف.',
    hasChildren: (n: number) => (n === 1 ? 'لهذه الفكرة فكرة فرعية واحدة.' : `لهذه الفكرة ${n} أفكار فرعية.`),
    cascade: 'احذفها مع فروعها',
    promote: 'احذفها وارفع فروعها',
    confirm: 'احذف',
    cancel: 'إلغاء',
  },

  linkMode: {
    banner: (title: string) => `اختر الفكرة التي تريد ربط «${title}» بها`,
    cancel: 'إلغاء الربط',
    done: 'تم ربط الفكرتين',
  },

  empty: {
    headline: 'ابدأ بفكرتك الأولى',
    body: 'كل ما يشغل ذهنك — مشروع، هدف، مسؤولية — يصبح فكرة تدور حول دماغك. أضف الفروع، واربط ما بينها، وعُد إليها حين تحتاج.',
    add: 'أضف أول فكرة',
    sample: 'استكشف شبكة نموذجية',
  },

  toasts: {
    undo: 'تراجع',
    undone: (what: string) => `تم التراجع: ${what}`,
    redone: (what: string) => `تمت الإعادة: ${what}`,
    deleted: 'تم حذف الفكرة',
    created: 'أُضيفت الفكرة',
    nothingToUndo: 'لا يوجد ما يمكن التراجع عنه',
    nothingToRedo: 'لا يوجد ما يمكن إعادته',
    quarantined: (n: number) => `عُزل ${n} سجل تالف عند التحميل حفاظًا على سلامة بياناتك. لم يُحذف شيء.`,
    repaired: (n: number) => `أُصلحت بنية ${n} فكرة كانت مرتبطة بأم غير موجودة.`,
    storageFailure: 'تعذّر فتح التخزين المحلي. ستعمل في جلسة مؤقتة — صدّر نسخة احتياطية قبل الإغلاق.',
    relayoutDone: 'أُعيد توزيع الشبكة',
    dismiss: 'إغلاق التنبيه',
  },

  scene: {
    canvasLabel: 'شبكة الأفكار ثلاثية الأبعاد. استخدم البحث أو لوحة التفاصيل للتنقل بلوحة المفاتيح.',
    loading: 'جارٍ تجهيز المدار…',
    webglError: 'تعذّر تشغيل العرض ثلاثي الأبعاد على هذا الجهاز. ما زالت أفكارك متاحة عبر البحث ولوحة التفاصيل.',
  },

  dialog: {
    close: 'إغلاق',
  },
} as const;

export const commandLabel: Record<CommandLabel, string> = {
  createNode: 'إضافة فكرة',
  updateNode: 'تعديل فكرة',
  moveNode: 'نقل فكرة',
  repositionNode: 'تحريك فكرة',
  deleteNode: 'حذف فكرة',
  connect: 'ربط فكرتين',
  updateEdge: 'تعديل علاقة',
  disconnect: 'إزالة رابط',
  addReminder: 'إضافة تذكير',
  updateReminder: 'تعديل تذكير',
  completeReminder: 'إكمال تذكير',
  reopenReminder: 'إعادة فتح تذكير',
  deleteReminder: 'حذف تذكير',
  relayout: 'إعادة توزيع الشبكة',
  import: 'استيراد نسخة',
  seed: 'الشبكة النموذجية',
};

export const errorMessage: Record<DomainErrorCode, string> = {
  TITLE_REQUIRED: 'اكتب عنوانًا للفكرة.',
  TITLE_TOO_LONG: 'العنوان طويل جدًا (الحد 120 حرفًا).',
  NODE_NOT_FOUND: 'لم تعد هذه الفكرة موجودة.',
  PARENT_NOT_FOUND: 'الفكرة الأم المختارة غير موجودة.',
  HIERARCHY_CYCLE: 'لا يمكن نقل فكرة تحت أحد فروعها.',
  SELF_PARENT: 'لا يمكن أن تكون الفكرة أمًّا لنفسها.',
  EDGE_SELF_LOOP: 'لا يمكن ربط الفكرة بنفسها.',
  EDGE_DUPLICATE: 'الفكرتان مرتبطتان بالفعل.',
  EDGE_NOT_FOUND: 'هذا الرابط لم يعد موجودًا.',
  REMINDER_NOT_FOUND: 'هذا التذكير لم يعد موجودًا.',
  INVALID_DATE: 'التاريخ غير صالح.',
  INVALID_TIMEZONE: 'المنطقة الزمنية غير صالحة.',
};

/** Gregorian calendar, Arabic language, Latin digits for unambiguous dates next to native inputs. */
const LOCALE = 'ar-u-ca-gregory-nu-latn';
const dtf = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
const df = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' });
const tf = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit' });
const rtf = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });

export const fmt = {
  dateTime: (iso: string) => dtf.format(new Date(iso)),
  date: (iso: string) => df.format(new Date(iso)),
  time: (iso: string) => tf.format(new Date(iso)),
  relative(iso: string, now: Date) {
    const diff = new Date(iso).getTime() - now.getTime();
    const mins = Math.round(diff / 60_000);
    if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    return rtf.format(Math.round(hours / 24), 'day');
  },
};
