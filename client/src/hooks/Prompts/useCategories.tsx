import { useLocalize, TranslationKeys } from '~/hooks';
import { CategoryIcon } from '~/components/Prompts';
import { useGetCategories } from '~/data-provider';

const loadingCategories: { label: TranslationKeys; value: string }[] = [
  {
    label: 'com_ui_loading',
    value: '',
  },
];

const emptyCategory: { label: TranslationKeys; value: string } = {
  label: 'com_ui_empty_category',
  value: '',
};

const useCategories = ({
  className = '',
  hasAccess = true,
  exclude = [],
}: {
  className?: string;
  hasAccess?: boolean;
  exclude?: string[];
}) => {
  const localize = useLocalize();

  const { data: categories = loadingCategories } = useGetCategories({
    enabled: hasAccess,
    select: (data) =>
      data
        .filter((category) => !exclude.includes(category.value))
        .map((category) => ({
          label: localize(category.label as TranslationKeys),
          value: category.value,
          icon: category.value ? (
            <CategoryIcon category={category.value} className={className} />
          ) : null,
        })),
  });

  return { categories, emptyCategory };
};

export default useCategories;
