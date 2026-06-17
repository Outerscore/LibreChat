import { BookmarkContext } from '~/Providers/BookmarkContext';
import { useConversationTagsQuery } from '~/data-provider';
import BookmarkTable from './BookmarkTable';

const BookmarkPanel = () => {
  const { data } = useConversationTagsQuery();

  return (
    <div className="h-auto max-w-full overflow-x-visible pt-2">
      <BookmarkContext.Provider value={{ bookmarks: data || [] }}>
        <BookmarkTable />
      </BookmarkContext.Provider>
    </div>
  );
};
export default BookmarkPanel;
