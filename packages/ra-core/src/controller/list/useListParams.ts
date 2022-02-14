import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import { parse, stringify } from 'query-string';
import lodashDebounce from 'lodash/debounce';
import pickBy from 'lodash/pickBy';
import { useNavigate, useLocation } from 'react-router-dom';

import { useStore } from '../../store';
import queryReducer, {
    SET_FILTERS,
    HIDE_FILTER,
    SHOW_FILTER,
    SET_PAGE,
    SET_PER_PAGE,
    SET_SORT,
    SORT_ASC,
} from './queryReducer';
import { SortPayload, FilterItem } from '../../types';
import removeEmpty from '../../util/removeEmpty';
import { convertFiltersToFilterItems } from './convertFiltersToFilterItems';

export interface ListParams {
    sort: string;
    order: string;
    page: number;
    perPage: number;
    filters: FilterItem[];
    displayedFilters: { [key: string]: boolean };
}

/**
 * Get the list parameters (page, sort, filters) and modifiers.
 *
 * These parameters are merged from 3 sources:
 *   - the query string from the URL
 *   - the params stored in the state (from previous navigation)
 *   - the options passed to the hook (including the filter defaultValues)
 *
 * @returns {Array} A tuple [parameters, modifiers].
 * Destructure as [
 *    { page, perPage, sort, order, filters, displayedFilters, requestSignature },
 *    { setFilters, hideFilter, showFilter, setPage, setPerPage, setSort }
 * ]
 *
 * @example
 *
 * const [listParams, listParamsActions] = useListParams({
 *      resource: 'posts',
 *      location: location // From react-router. Injected to your component by react-admin inside a List
 *      filterDefaultValues: {
 *          published: true
 *      },
 *      sort: {
 *          field: 'published_at',
 *          order: 'DESC'
 *      },
 *      perPage: 25
 * });
 *
 * const {
 *      page,
 *      perPage,
 *      sort,
 *      order,
 *      filters,
 *      displayedFilters,
 *      requestSignature
 * } = listParams;
 *
 * const {
 *      setFilters,
 *      hideFilter,
 *      showFilter,
 *      setPage,
 *      setPerPage,
 *      setSort,
 * } = listParamsActions;
 */
export const useListParams = ({
    resource,
    filterDefaultValues,
    sort = defaultSort,
    perPage = 10,
    debounce = 500,
    disableSyncWithLocation = false,
}: ListParamsOptions): [Parameters, Modifiers] => {
    const location = useLocation();
    const navigate = useNavigate();
    const [localParams, setLocalParams] = useState<Partial<ListParams>>();
    const [storeParams, setStoreParams] = useStore<Partial<ListParams>>(
        `${resource}.listParams`
    );
    const tempParams = useRef<Partial<ListParams>>();

    const requestSignature = [
        location.search,
        resource,
        JSON.stringify(disableSyncWithLocation ? localParams : storeParams),
        JSON.stringify(filterDefaultValues),
        JSON.stringify(sort),
        perPage,
        disableSyncWithLocation,
    ];

    const queryFromLocation = disableSyncWithLocation
        ? {}
        : parseQueryFromLocation(location);

    const query = useMemo(
        () =>
            getQuery({
                queryFromLocation,
                savedParams: disableSyncWithLocation
                    ? localParams
                    : storeParams,
                filterDefaultValues,
                sort,
                perPage,
            }),
        requestSignature // eslint-disable-line react-hooks/exhaustive-deps
    );

    // if the location includes params (for example from a link like
    // the categories products on the demo), we need to persist them in the
    // store as well so that we don't lose them after a redirection back
    // to the list
    useEffect(() => {
        if (Object.keys(queryFromLocation).length > 0) {
            setStoreParams(query);
        }
    }, [location.search]); // eslint-disable-line

    const changeParams = useCallback(action => {
        if (!tempParams.current) {
            // no other changeParams action dispatched this tick
            tempParams.current = queryReducer(query, action);
            // schedule side effects for next tick
            setTimeout(() => {
                if (disableSyncWithLocation) {
                    setLocalParams(tempParams.current);
                } else {
                    // the useEffect above will apply the changes to the params in the store
                    navigate(
                        {
                            search: `?${stringify({
                                ...tempParams.current,
                                filters: JSON.stringify(
                                    tempParams.current.filters
                                ),
                                displayedFilters: JSON.stringify(
                                    tempParams.current.displayedFilters
                                ),
                            })}`,
                        },
                        {
                            state: { _scrollToTop: action.type === SET_PAGE },
                        }
                    );
                }
                tempParams.current = undefined;
            }, 0);
        } else {
            // side effects already scheduled, just change the params
            tempParams.current = queryReducer(tempParams.current, action);
        }
    }, requestSignature); // eslint-disable-line react-hooks/exhaustive-deps

    const setSort = useCallback(
        (sort: SortPayload) =>
            changeParams({
                type: SET_SORT,
                payload: sort,
            }),
        requestSignature // eslint-disable-line react-hooks/exhaustive-deps
    );

    const setPage = useCallback(
        (newPage: number) => changeParams({ type: SET_PAGE, payload: newPage }),
        requestSignature // eslint-disable-line react-hooks/exhaustive-deps
    );

    const setPerPage = useCallback(
        (newPerPage: number) =>
            changeParams({ type: SET_PER_PAGE, payload: newPerPage }),
        requestSignature // eslint-disable-line react-hooks/exhaustive-deps
    );

    const debouncedSetFilters = lodashDebounce(
        (
            filters: FilterItem[],
            displayedFilters: { [key: string]: boolean }
        ) => {
            changeParams({
                type: SET_FILTERS,
                payload: {
                    filters: removeEmpty(filters),
                    displayedFilters,
                },
            });
        },
        debounce
    );

    const setFilters = useCallback(
        (
            filters: FilterItem[],
            displayedFilters: { [key: string]: boolean },
            debounce = true
        ) =>
            debounce
                ? debouncedSetFilters(filters, displayedFilters)
                : changeParams({
                      type: SET_FILTERS,
                      payload: {
                          filters: removeEmpty(filters),
                          displayedFilters,
                      },
                  }),
        requestSignature // eslint-disable-line react-hooks/exhaustive-deps
    );

    const hideFilter = useCallback((filterName: string) => {
        changeParams({
            type: HIDE_FILTER,
            payload: filterName,
        });
    }, requestSignature); // eslint-disable-line react-hooks/exhaustive-deps

    const showFilter = useCallback((filterName: string, defaultValue: any) => {
        changeParams({
            type: SHOW_FILTER,
            payload: {
                filterName,
                defaultValue,
            },
        });
    }, requestSignature); // eslint-disable-line react-hooks/exhaustive-deps

    return [
        {
            filters: query.filters || emptyArray,
            displayedFilters: query.displayedFilters || emptyObject,
            requestSignature,
            ...query,
        },
        {
            changeParams,
            setPage,
            setPerPage,
            setSort,
            setFilters,
            hideFilter,
            showFilter,
        },
    ];
};

export const validQueryParams = [
    'page',
    'perPage',
    'sort',
    'order',
    'filters',
    // @FIXME: remove in v5
    'filter',
    'displayedFilters',
];

const parseObject = (query, field) => {
    if (query[field] && typeof query[field] === 'string') {
        try {
            query[field] = JSON.parse(query[field]);
        } catch (err) {
            delete query[field];
        }
    }
};

export const parseQueryFromLocation = ({ search }): Partial<ListParams> => {
    const query = pickBy(
        parse(search),
        (v, k) => validQueryParams.indexOf(k) !== -1
    );
    parseObject(query, 'filters');
    parseObject(query, 'displayedFilters');
    // @FIXME: remove in v5
    // support for old filter syntax filter={foo: 'bar'} instead of filters={[{ key: 'foo', value: 'bar' }]}
    if (!query.filters && query.filter && typeof query.filter === 'string') {
        try {
            const filterObject = JSON.parse(query.filter);
            query.filters = convertFiltersToFilterItems(filterObject);
        } catch (err) {}
        delete query.filter;
    }
    return query;
};

/**
 * Check if user has already set custom sort, page, or filters for this list
 *
 * User params come from the store as the params props. By default,
 * this object is:
 *
 * { filters: [], order: null, page: 1, perPage: null, sort: null }
 *
 * To check if the user has custom params, we must compare the params
 * to these initial values.
 *
 * @param {Object} params
 */
export const hasCustomParams = (params: Partial<ListParams>) => {
    return (
        params &&
        ((params.filters && params.filters.length > 0) ||
            params.order != null ||
            (params.page && params.page !== 1) ||
            params.perPage != null ||
            params.sort != null)
    );
};

/**
 * Merge list params from 3 different sources:
 *   - the query string
 *   - the params stored in the state (from previous navigation)
 *   - the props passed to the List component (including the filter defaultValues)
 */
export const getQuery = ({
    queryFromLocation,
    savedParams,
    filterDefaultValues,
    sort,
    perPage,
}: {
    queryFromLocation: Partial<ListParams>;
    savedParams?: Partial<ListParams>;
    filterDefaultValues?: FilterItem[];
    sort: SortPayload;
    perPage: number;
}): ListParams => {
    const query: Partial<ListParams> =
        Object.keys(queryFromLocation).length > 0
            ? queryFromLocation
            : hasCustomParams(savedParams)
            ? { ...savedParams }
            : { filters: filterDefaultValues || [] };

    if (!query.sort) {
        query.sort = sort.field;
        query.order = sort.order;
    }
    if (query.perPage == null) {
        query.perPage = perPage;
    }
    if (query.page == null) {
        query.page = 1;
    }

    return {
        ...query,
        page: getNumberOrDefault(query.page, 1),
        perPage: getNumberOrDefault(query.perPage, 10),
    } as ListParams;
};

export const getNumberOrDefault = (
    possibleNumber: string | number | undefined,
    defaultValue: number
) => {
    const parsedNumber =
        typeof possibleNumber === 'string'
            ? parseInt(possibleNumber, 10)
            : possibleNumber;

    return isNaN(parsedNumber) ? defaultValue : parsedNumber;
};

export interface ListParamsOptions {
    resource: string;
    perPage?: number;
    sort?: SortPayload;
    // default value for a filter when displayed but not yet set
    filterDefaultValues?: FilterItem[];
    debounce?: number;
    // Whether to disable the synchronization of the list parameters with
    // the current location (URL search parameters)
    disableSyncWithLocation?: boolean;
}

interface Parameters extends ListParams {
    requestSignature: any[];
}

interface Modifiers {
    changeParams: (action: any) => void;
    setPage: (page: number) => void;
    setPerPage: (pageSize: number) => void;
    setSort: (sort: SortPayload) => void;
    setFilters: (
        filters: FilterItem[],
        displayedFilters: { [key: string]: boolean }
    ) => void;
    hideFilter: (filterName: string) => void;
    showFilter: (filterName: string, defaultValue: any) => void;
}

const emptyObject = {};
const emptyArray = [];

const defaultSort = {
    field: 'id',
    order: SORT_ASC,
};
