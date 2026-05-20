import React from 'react';
import LanguageSwitcher from './LanguageSwitcher';
import ModeIndicator from './ModeIndicator';
import EditModeButton from './EditModeButton';
import UserProfileMenu from './UserProfileMenu';
import ManageButton from './ManageButton';

/**
 * Top Bar Component - combines language switcher, mode indicator, edit button, and user profile
 * @param {Object} props
 * @param {boolean} props.editMode - current edit mode state
 * @param {Function} props.onToggleEditMode - callback when edit mode toggles
 * @param {Function} props.onChangeLanguage - callback when language changes
 * @param {Function} props.onManageClick - callback when manage button clicked
 * @param {Object} props.userData - user data for profile display
 * @param {Function} props.onLogout - callback when user logs out
 */
function TopBar({ editMode, onToggleEditMode, onChangeLanguage, onManageClick, userData, onLogout }) {
    // Check if user is manager (is_manager === 1 or "1")
    const isManager = userData?.is_manager == 1;

    return (
        <div className="absolute top-4 right-6 z-0 flex items-center gap-3">
            <LanguageSwitcher onChangeLanguage={onChangeLanguage} />
            <ModeIndicator editMode={editMode} />
            {/* Only show Edit/Manage buttons if user is manager */}
            {isManager && <ManageButton onClick={onManageClick} />}
            {isManager && <EditModeButton editMode={editMode} onToggle={onToggleEditMode} />}
            <UserProfileMenu userData={userData} onLogout={onLogout} />
        </div>
    );
}

export default React.memo(TopBar);
